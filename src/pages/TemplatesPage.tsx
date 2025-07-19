import React from 'react'
import Layout from '../layout'
import Templates from '../components/Templates'

const TemplatesPage: React.FC = () => {
  // Template data - in a real app this might come from a CMS or markdown files
  const templateData = {
    nodes: [
      {
        id: 'general-template',
        parent: { base: 'general-qip-template.md' },
        frontmatter: {
          qip: 0,
          title: 'General QIP Template',
          author: 'QiDAO Team'
        },
        html: '<p>Use this template for general protocol improvements and changes.</p>'
      },
      {
        id: 'new-asset-template',
        parent: { base: 'new-asset-template.md' },
        frontmatter: {
          qip: 0,
          title: 'New Asset Template',
          author: 'QiDAO Team'
        },
        html: '<p>Use this template when proposing to add new collateral assets to QiDAO.</p>'
      }
    ]
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8">QIP Templates</h1>
        <div className="prose prose-lg max-w-none mb-8">
          <p>
            Use these templates as a starting point for your QIP. Each template provides
            a structured format for different types of proposals.
          </p>
        </div>
        <Templates templates={templateData} />
      </div>
    </Layout>
  )
}

export default TemplatesPage