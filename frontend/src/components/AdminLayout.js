import React, { useState } from "react";
import Sidebar from "./Sidebar";
import AdminCursoDetalle from "../pages/AdminCursoDetalle";
import AdminCursos from "../pages/AdminCursos";
import Profesores from "../pages/Profesores";

export default function AdminLayout({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("profesores");
  const [selectedGroup, setSelectedGroup] = useState(null);

  const selectTab = (tab) => {
    setSelectedGroup(null);
    setActiveTab(tab);
  };

  return (
    <div className="flex min-h-screen bg-gray-100">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={selectTab}
        onLogout={onLogout}
        userEmail={user?.email}
      />
      <main className="flex-1 p-8 max-w-5xl">
        {activeTab === "profesores" && <Profesores />}
        {activeTab === "cursos" && !selectedGroup && (
          <AdminCursos
            onSelectGroup={(g) => {
              setSelectedGroup(g);
              setActiveTab("curso-detalle-admin");
            }}
          />
        )}
        {activeTab === "curso-detalle-admin" && selectedGroup && (
          <AdminCursoDetalle group={selectedGroup} onBack={() => selectTab("cursos")} />
        )}
      </main>
    </div>
  );
}
