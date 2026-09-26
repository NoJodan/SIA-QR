import React, { useState } from "react";
import ProfSidebar from "./ProfSidebar";
import ProfConfiguraciones from "../pages/ProfConfiguraciones";

export default function ProfLayout({ user, onLogout, onRefreshUser }) {
  const [activeTab, setActiveTab] = useState("configuraciones");

  return (
    <div className="flex min-h-screen bg-gray-100">
      <ProfSidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onLogout={onLogout}
        userEmail={user?.email}
      />
      <main className="flex-1 p-8 max-w-5xl">
        {activeTab === "configuraciones" && (
          <ProfConfiguraciones key={user?.employee_code} user={user} onSaved={onRefreshUser} />
        )}
      </main>
    </div>
  );
}
