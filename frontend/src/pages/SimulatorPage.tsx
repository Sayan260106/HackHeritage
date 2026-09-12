import React from "react";
import { KeypadPhone } from "../components/KeypadPhone";

interface SimulatorPageProps {
  onExit?: () => void;
}

export default function SimulatorPage({ onExit }: SimulatorPageProps) {
  return <KeypadPhone onBackToConsole={onExit} />;
}
