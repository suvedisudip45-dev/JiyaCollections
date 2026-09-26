import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";

const AppShell = () => (
  <div className="min-h-screen bg-[var(--mp-bg)]">
    <Sidebar />
    <div className="lg:pl-[var(--sidebar-w)] flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 px-4 sm:px-6 py-6 overflow-x-hidden">
        <div className="max-w-7xl mx-auto fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  </div>
);

export default AppShell;
