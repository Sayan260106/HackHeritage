import React from "react";
import { SpotlightCard } from "./SpotlightCard";
import { Reveal } from "./Reveal";
import { cn } from "../../lib/cn";

export const BentoGrid: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div
    className={cn(
      "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6",
      className,
    )}
  >
    {children}
  </div>
);

interface BentoCellProps {
  /** Plate number, lettered top-left as on a survey sheet. */
  sheet: string;
  title: string;
  children: React.ReactNode;
  /** Column span at lg and above. */
  span?: 2 | 3 | 4 | 6;
  /** Renders the cell taller, for the anchor tiles. */
  tall?: boolean;
  icon?: React.ReactNode;
  delay?: number;
  className?: string;
}

const SPAN: Record<number, string> = {
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  6: "lg:col-span-6",
};

export const BentoCell: React.FC<BentoCellProps> = ({
  sheet,
  title,
  children,
  span = 2,
  tall = false,
  icon,
  delay = 0,
  className,
}) => (
  <Reveal delay={delay} className={cn(SPAN[span], className)}>
    <SpotlightCard className={cn("h-full", tall && "lg:min-h-[19rem]")}>
      <div className="flex h-full flex-col p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="plate-label">{sheet}</span>
          {icon && <span className="text-shoal/70">{icon}</span>}
        </div>

        <h3 className="mt-5 font-display text-[1.35rem] font-semibold leading-[1.15] text-chartpaper">
          {title}
        </h3>

        <div className="mt-3 text-[13.5px] leading-relaxed text-slate-300">
          {children}
        </div>
      </div>
    </SpotlightCard>
  </Reveal>
);
