import React, { useState } from "react";
import ProfSidebar from "./ProfSidebar";
import ClaseDetalle from "../pages/ClaseDetalle";
import CursoDetalle from "../pages/CursoDetalle";
import MisCursos from "../pages/MisCursos";
import ProfConfiguraciones from "../pages/ProfConfiguraciones";

export default function ProfLayout({ user, onLogout, onRefreshUser }) {
  const [activeTab, setActiveTab] = useState("mis-cursos");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedClass, setSelectedClass] = useState(null);

  const selectGroup = (group) => {
    setSelectedGroup(group);
    setSelectedClass(null);
    setActiveTab("curso-detalle");
  };

  const selectClass = (classItem) => {
    setSelectedClass(classItem);
    setActiveTab("clase-detalle");
  };

  const goToGroups = () => {
    setSelectedGroup(null);
    setSelectedClass(null);
    setActiveTab("mis-cursos");
  };

  const goToGroupDetail = () => {
    setSelectedClass(null);
    setActiveTab("curso-detalle");
  };

  const handleSelectTab = (tab) => {
    if (tab === "curso-detalle" && !selectedGroup) return;
    if (tab === "mis-cursos") {
      goToGroups();
      return;
    }
    if (tab === "configuraciones") setSelectedClass(null);
    setActiveTab(tab);
  };

  return (
    <div className="flex min-h-screen bg-gray-100">
      <ProfSidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onLogout={onLogout}
        userEmail={user?.email}
      />
      <main className="flex-1 p-8 max-w-5xl">
        {activeTab === "mis-cursos" && <MisCursos onSelectGroup={selectGroup} />}
        {activeTab === "curso-detalle" && selectedGroup && (
          <CursoDetalle group={selectedGroup} onBack={goToGroups} onSelectClass={selectClass} />
        )}
        {activeTab === "clase-detalle" && selectedGroup && selectedClass && (
          <ClaseDetalle group={selectedGroup} classItem={selectedClass} onBack={goToGroupDetail} />
        )}
        {activeTab === "configuraciones" && (
          <ProfConfiguraciones key={user?.employee_code} user={user} onSaved={onRefreshUser} />
        )}
      </main>
    </div>
  );
}
