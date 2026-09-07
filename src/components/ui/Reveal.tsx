import React, { useRef } from "react";
import { motion, useInView } from "motion/react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article" | "header";
}

export const Reveal: React.FC<RevealProps> = ({
  children,
  delay = 0,
  distance = 22,
  className,
  as = "div",
}) => {
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-12% 0px -12% 0px" });
  const reduced = usePrefersReducedMotion();
  const motionTags = {
    div: motion.div,
    section: motion.section,
    li: motion.li,
    article: motion.article,
    header: motion.header,
  } as const;
  const Tag = motionTags[as];
  const setRef = (node: HTMLElement | null) => {
    ref.current = node;
  };

  if (reduced) {
    const Plain = as as React.ElementType;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Tag
      ref={setRef}
      className={className}
      initial={{ opacity: 0, y: distance }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: distance }}
      transition={{ duration: 0.72, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Tag>
  );
};
