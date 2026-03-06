import React from "react";
import { Outlet } from "react-router-dom";
import { CourseTabBar } from "./CourseTabBar";

export function AppLayout() {
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <CourseTabBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

/** Wrapper for pages that don't have a course sidebar (Welcome, Settings, etc.) */
export function PlainPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 overflow-y-auto p-6">{children}</main>
  );
}
