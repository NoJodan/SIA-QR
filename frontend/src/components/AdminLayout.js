import React, { useState } from "react";
import Sidebar from "./Sidebar";
import Profesores from "../pages/Profesores";

export default function AdminLayout({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("profesores");

  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onLogout={onLogout}
        userEmail={user?.email}
      />
      <main className="flex-1 p-8 max-w-5xl">
        {activeTab === "profesores" && <Profesores />}
      </main>
    </div>
  );
}
