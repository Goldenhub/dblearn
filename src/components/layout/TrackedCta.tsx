"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ctaClicked } from "@/lib/dblearnlytics";

export default function TrackedCta({
  href,
  label,
  location,
  className,
  children,
  external = false,
}: {
  href: string;
  label: string;
  location: string;
  className: string;
  children: ReactNode;
  external?: boolean;
}) {
  const track = () => ctaClicked(label, location);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className} onClick={track}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={track}>
      {children}
    </Link>
  );
}