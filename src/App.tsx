import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Web3Provider } from './providers/Web3Provider'
import { getBasePath } from './utils/routing'

// Pages
import HomePage from './pages/HomePage'
import AllProposals from './pages/AllProposals'
import AllProposalsPaginated from './pages/AllProposalsPaginated'
import CreateProposal from './pages/CreateProposal'
import QIPDetail from './pages/QIPDetail'
import TemplatesPage from './pages/TemplatesPage'
import EditProposal from "./pages/EditProposal";

function App() {
  // Get the base path for React Router
  const basePath = getBasePath();
  console.log('React Router basename:', basePath || '/');

  return (
    <Web3Provider>
      <Router basename={basePath}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/all-proposals" element={<AllProposalsPaginated />} />
          <Route path="/qips/:qipNumber" element={<QIPDetail />} />
          <Route path="/create-proposal" element={<CreateProposal />} />
          <Route path="/edit-proposal" element={<EditProposal />} />
          <Route path="/templates" element={<TemplatesPage />} />
        </Routes>
      </Router>
    </Web3Provider>
  );
}

export default App