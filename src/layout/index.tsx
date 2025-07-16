import React from 'react';
import { useEffect } from 'react';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import LocalModeBanner from '../components/LocalModeBanner';

interface Props {
    children: React.ReactNode;
}

const toggleTheme = (e: React.MouseEvent<HTMLAnchorElement>) => {
  e.preventDefault();
  const element = document.body;
  document.getElementById("theme-toggle-dark-icon")?.classList.toggle("hidden");
  document.getElementById("theme-toggle-light-icon")?.classList.toggle("hidden");
  const result = element.classList.toggle("dark");
  localStorage.setItem("theme", result ? "dark" : "light");
};

const initTheme = () => {
    const element = document.body;
    if (element.classList.contains('dark')) {
        document
            .getElementById('theme-toggle-light-icon')
            ?.classList.remove('hidden');
    } else {
        document
            .getElementById('theme-toggle-dark-icon')
            ?.classList.remove('hidden');
    }
};

const Layout: React.FC<Props> = ({ children }) => {
    useEffect(() => {
        initTheme();
    }, []);

    return (
        <main className="min-h-screen">
            <LocalModeBanner />
            
            <header className="site-header h-20" role="banner">
                <Navigation />
            </header>

            <main className="page-content">
                <div className="wrapper">{children}</div>
            </main>

            <Footer />

        </main>
    );
};

export default Layout;
