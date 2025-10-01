import React from 'react';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import LocalModeBanner from '../components/LocalModeBanner';
import { Toaster } from '@/components/ui/sonner';
import { useQITokenBalance } from '../hooks/useQITokenBalance';

interface Props {
    children: React.ReactNode;
}

const Layout: React.FC<Props> = ({ children }) => {
    // Theme is now managed by the ThemeProvider context

    // Pre-cache QI token balance on site load (runs when wallet connected in prod mode)
    useQITokenBalance();

    return (
        <main className="min-h-screen">
            <LocalModeBanner />

            <header className="site-header h-20" role="banner">
                <Navigation />
            </header>

            <main className="page-content">
                <div className="wrapper">{children}</div>
            </main>

            <Toaster />
        </main>
    );
};

export default Layout;
