import React from "react";

export default function SearchBar({ value, onChange, placeholder = "Buscar..." }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="border rounded-lg px-3 py-2 text-sm w-full md:w-64"
    />
  );
}
