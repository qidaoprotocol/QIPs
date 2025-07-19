import React from 'react'
import { Link } from 'react-router-dom'
import Layout from '../layout'

const HomePage: React.FC = () => {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold mb-6">QiDAO Improvement Proposals</h1>
          
          <div className="prose prose-lg max-w-none mb-8">
            <p>
              Welcome to the QiDAO Improvement Proposals (QIPs) platform. This is where the QiDAO community
              collaborates on protocol improvements and governance decisions.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <Link
              to="/all-proposals"
              className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
            >
              <h2 className="text-2xl font-semibold mb-2">View All Proposals</h2>
              <p className="text-gray-600">
                Browse all QIPs organized by status. See what's being discussed, voted on, and implemented.
              </p>
            </Link>

            <Link
              to="/create-proposal"
              className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow"
            >
              <h2 className="text-2xl font-semibold mb-2">Create New Proposal</h2>
              <p className="text-gray-600">
                Have an idea to improve QiDAO? Submit a new proposal for community review.
              </p>
            </Link>
          </div>

          <div className="bg-gray-100 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-3">How It Works</h3>
            <ol className="list-decimal list-inside space-y-2">
              <li>Create a proposal using our templates or from scratch</li>
              <li>Community reviews and provides feedback</li>
              <li>Proposal moves to Snapshot for voting</li>
              <li>Approved proposals are implemented by the team</li>
            </ol>
          </div>

          <div className="mt-8 text-center">
            <Link
              to="/templates"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              View proposal templates →
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default HomePage