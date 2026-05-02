import React, { useState, useRef, useEffect, useMemo } from 'react';

interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

export function Autocomplete({ value, onChange, options, placeholder, className }: AutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!value) return options;
    const lowerValue = value.toLowerCase();
    
    // Exact matches
    const exact = options.filter(o => o.toLowerCase() === lowerValue);
    // Starts with
    const startsWith = options.filter(o => o.toLowerCase().startsWith(lowerValue) && o.toLowerCase() !== lowerValue);
    // Includes
    const includes = options.filter(o => o.toLowerCase().includes(lowerValue) && !o.toLowerCase().startsWith(lowerValue));
    
    // Sort by relevance: exact > startsWith > includes
    const result = [...exact, ...startsWith, ...includes];
    
    // Show all options if nothing matches, or maybe just the filtered ones
    // Usually it's better to just show filtered.
    return result;
  }, [value, options]);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className={className}
        placeholder={placeholder}
      />
      
      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-divider rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {filteredOptions.map((option, index) => (
            <div
              key={index}
              className="px-4 py-3 hover:bg-gray-50 cursor-pointer text-sm text-ink/80 font-medium"
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
