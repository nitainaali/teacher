import { Outlet } from "react-router-dom";
import { CourseSidebar } from "./CourseSidebar";

export function CourseLayout() {
  return (
    <>
      <CourseSidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </>
  );
}
