import fs from 'node:fs';
import path from 'node:path';
import {
  ConversationSession,
  ConversationTurn,
  LanguageCode,
  LocationInfo,
  OrcaAnalysisResponse,
  TimeWindow
} from '../../src/types.ts';
import { COASTAL_LOCATIONS } from '../../src/data/coastalData.ts';
import { resolveLocation, resolveTimeWindow } from './marineService.ts';

// In-memory persistent session store with disk-backed JSON persistence
const sessions = new Map<string, ConversationSession>();
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSIONS_DIR = path.resolve(process.cwd(), 'data', 'sessions');

function ensureSessionDirectory(): void {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn(`[ConversationSession] Failed to ensure directory ${SESSIONS_DIR}:`, err);
  }
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getSessionFilePath(sessionId: string): string {
  return path.join(SESSIONS_DIR, `${sanitizeSessionId(sessionId)}.json`);
}

function persistSessionToDisk(session: ConversationSession): void {
  try {
    ensureSessionDirectory();
    const filePath = getSessionFilePath(session.sessionId);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[ConversationSession] Failed to persist session ${session.sessionId} to disk:`, err);
  }
}

function loadSessionFromDisk(sessionId: string): ConversationSession | null {
  try {
    const filePath = getSessionFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const session = JSON.parse(data) as ConversationSession;
      const updatedMs = new Date(session.updatedAt || session.createdAt).getTime();
      if (Date.now() - updatedMs > SESSION_TTL_MS) {
        try { fs.unlinkSync(filePath); } catch {}
        return null;
      }
      return session;
    }
  } catch (err) {
    console.warn(`[ConversationSession] Failed to load session ${sessionId} from disk:`, err);
  }
  return null;
}

function generateId(prefix = 'session'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Checks whether a natural language query contains explicit mention of a known coastal port or coordinates.
 */
export function hasExplicitLocationMention(query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();

  // Coordinate check
  if (/(-?\d+\.?\d*)\s*°?\s*([nNsS])?\s*,\s*(-?\d+\.?\d*)/.test(query)) {
    return true;
  }

  for (const [key, loc] of Object.entries(COASTAL_LOCATIONS)) {
    if (
      q.includes(key) ||
      q.includes(loc.name.toLowerCase()) ||
      (loc.state && q.includes(loc.state.toLowerCase())) ||
      (loc.nearestPort && q.includes(loc.nearestPort.toLowerCase()))
    ) {
      return true;
    }
  }

  const explicitKeywords = [
    'digha', 'puri', 'vizag', 'visakhapatnam', 'paradeep', 'paradip',
    'kochi', 'cochin', 'chennai', 'madras', 'mumbai', 'bombay',
    'goa', 'mangalore', 'veraval', 'porbandar', 'andaman', 'port blair',
    'sundarban', 'sundarbans', 'bengal', 'kerala', 'odisha', 'gujarat'
  ];

  return explicitKeywords.some(keyword => q.includes(keyword));
}

/**
 * Checks whether a natural language query contains explicit temporal keywords.
 */
export function hasExplicitTimeMention(query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();
  const timeKeywords = [
    'tomorrow', 'morning', 'afternoon', 'evening', 'night',
    'tonight', 'now', 'today', 'right now', 'next week',
    'কাল', 'আজ', 'সকাল', 'সন্ধ্যা', 'कल', 'आज', 'सुबह', 'शाम',
    'நாளை', 'இன்று', 'రేపు', 'ఈరోజు'
  ];
  return timeKeywords.some(keyword => q.includes(keyword));
}

export function getOrCreateSession(
  sessionId?: string,
  initialLocation?: LocationInfo
): ConversationSession {
  if (sessionId) {
    if (sessions.has(sessionId)) {
      const existing = sessions.get(sessionId)!;
      existing.updatedAt = new Date().toISOString();
      persistSessionToDisk(existing);
      return existing;
    }
    const onDisk = loadSessionFromDisk(sessionId);
    if (onDisk) {
      onDisk.updatedAt = new Date().toISOString();
      sessions.set(sessionId, onDisk);
      persistSessionToDisk(onDisk);
      return onDisk;
    }
  }

  // Enforce capacity bounds
  if (sessions.size >= MAX_SESSIONS) {
    const oldestKey = sessions.keys().next().value;
    if (oldestKey) sessions.delete(oldestKey);
  }

  const newId = sessionId || generateId('session');
  const now = new Date().toISOString();
  const session: ConversationSession = {
    sessionId: newId,
    createdAt: now,
    updatedAt: now,
    title: initialLocation ? `${initialLocation.name} Marine Advisory` : 'Marine Advisory Thread',
    turns: [],
    activeLocation: initialLocation || COASTAL_LOCATIONS.digha,
  };

  sessions.set(newId, session);
  persistSessionToDisk(session);
  return session;
}

export function getSession(sessionId: string): ConversationSession | undefined {
  if (sessions.has(sessionId)) {
    return sessions.get(sessionId);
  }
  const onDisk = loadSessionFromDisk(sessionId);
  if (onDisk) {
    sessions.set(sessionId, onDisk);
    return onDisk;
  }
  return undefined;
}

export function listSessions(): Array<{
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  locationName?: string;
}> {
  try {
    ensureSessionDirectory();
    const files = fs.readdirSync(SESSIONS_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const id = file.replace(/\.json$/, '');
        if (!sessions.has(id)) {
          const loaded = loadSessionFromDisk(id);
          if (loaded) sessions.set(loaded.sessionId, loaded);
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return Array.from(sessions.values())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(s => ({
      sessionId: s.sessionId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      turnCount: s.turns.length,
      locationName: s.activeLocation?.name,
    }));
}

export function deleteSession(sessionId: string): boolean {
  const memDeleted = sessions.delete(sessionId);
  let diskDeleted = false;
  try {
    const filePath = getSessionFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      diskDeleted = true;
    }
  } catch (err) {
    console.warn(`[ConversationSession] Failed to delete file for session ${sessionId}:`, err);
  }
  return memDeleted || diskDeleted;
}

export function clearAllSessions(): void {
  sessions.clear();
  try {
    ensureSessionDirectory();
    const files = fs.readdirSync(SESSIONS_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(SESSIONS_DIR, file));
      }
    }
  } catch (err) {
    console.warn('[ConversationSession] Failed to clear sessions directory:', err);
  }
}

/**
 * Contextual resolution: Resolves location & time window for a multi-turn conversation turn.
 * If the user does not specify a new location, the session's active location is retained.
 */
export function resolveConversationalContext(
  query: string,
  sessionId?: string,
  locationOverride?: string,
  timeOverride?: string
): {
  session: ConversationSession;
  resolvedLocation: LocationInfo;
  resolvedTimeWindow: TimeWindow;
} {
  const session = getOrCreateSession(sessionId);

  let targetLocation: LocationInfo;
  if (locationOverride) {
    targetLocation = resolveLocation(query, locationOverride);
  } else if (hasExplicitLocationMention(query)) {
    targetLocation = resolveLocation(query);
  } else if (session.activeLocation) {
    targetLocation = session.activeLocation;
  } else {
    targetLocation = resolveLocation(query);
  }

  let targetTimeWindow: TimeWindow;
  if (timeOverride) {
    targetTimeWindow = resolveTimeWindow(query, timeOverride);
  } else if (hasExplicitTimeMention(query)) {
    targetTimeWindow = resolveTimeWindow(query);
  } else if (session.activeTimeWindow) {
    targetTimeWindow = session.activeTimeWindow;
  } else {
    targetTimeWindow = resolveTimeWindow(query);
  }

  return {
    session,
    resolvedLocation: targetLocation,
    resolvedTimeWindow: targetTimeWindow,
  };
}

/**
 * Records a completed turn into the conversation session.
 */
export function recordSessionTurn(
  sessionId: string,
  query: string,
  analysis: OrcaAnalysisResponse
): ConversationSession {
  const session = getOrCreateSession(sessionId);
  const turnId = generateId('turn');

  const turn: ConversationTurn = {
    turnId,
    query,
    timestamp: new Date().toISOString(),
    language: analysis.language,
    detectedIntent: analysis.detectedIntent,
    locationName: analysis.location.name,
    responseSummary: analysis.groundedSummary,
    responseAnalysis: analysis,
  };

  session.turns.push(turn);
  session.updatedAt = new Date().toISOString();
  session.activeLocation = analysis.location;
  session.activeTimeWindow = analysis.timeWindow;
  session.activeRiskLevel = analysis.risk.riskLevel;
  session.activeDecision = analysis.operationalDecision;

  // Extract best PFZ zone id and full PFZ analysis if present
  if (analysis.pfz && typeof analysis.pfz === 'object') {
    session.activePfz = analysis.pfz;
    const pfzObj = analysis.pfz as any;
    if (pfzObj.bestZone?.id) {
      session.activePfzZoneId = pfzObj.bestZone.id;
    }
  }

  // Preserve active safe route if computed
  if (analysis.safeRoute) {
    session.activeRoute = analysis.safeRoute;
  }

  // Preserve active geofence spatial analysis
  if (analysis.geofenceAnalysis) {
    session.activeGeofence = analysis.geofenceAnalysis;
  }

  // Generate a concise session title from the first turn
  if (session.turns.length === 1) {
    const loc = analysis.location.name.split(' ')[0];
    const intentShort = analysis.detectedIntent.replace(/_/g, ' ');
    session.title = `${loc}: ${intentShort.slice(0, 24)}`;
  }

  persistSessionToDisk(session);
  return session;
}
