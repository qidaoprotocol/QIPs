import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  toggleThemeWithTransition: (x: number, y: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // Initialize theme from localStorage or system preference
  const getInitialTheme = (): Theme => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
    
    // Fall back to system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  };
  
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  
  // Apply theme to DOM on mount and when theme changes
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    
    // Remove both classes first to ensure clean state
    root.classList.remove('light', 'dark');
    body.classList.remove('light', 'dark');
    
    // Apply new theme
    root.classList.add(theme);
    body.classList.add(theme);
    
    // Save to localStorage
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const toggleThemeWithTransition = (x: number, y: number) => {
    // Check if View Transitions API is supported
    if (!document.startViewTransition) {
      // Fallback to regular toggle for unsupported browsers
      toggleTheme();
      return;
    }

    // Set CSS custom properties for the transition origin
    document.documentElement.style.setProperty('--x', `${x}px`);
    document.documentElement.style.setProperty('--y', `${y}px`);

    // Start the view transition
    document.startViewTransition(() => {
      setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, toggleThemeWithTransition }}>
      {children}
    </ThemeContext.Provider>
  );
};