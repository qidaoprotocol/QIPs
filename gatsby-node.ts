import type { GatsbyNode } from 'gatsby';
import { sourceQIPsFromChain } from './src/utils/qip-data-source';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({
  path: `.env`,
});

// Configuration
const QIP_REGISTRY_ADDRESS = process.env.GATSBY_QIP_REGISTRY_ADDRESS as `0x${string}`;
const PINATA_JWT = process.env.GATSBY_PINATA_JWT || '';
const PINATA_GATEWAY = process.env.GATSBY_PINATA_GATEWAY || 'https://gateway.pinata.cloud';
const BASE_RPC_URL = process.env.GATSBY_BASE_RPC_URL;
const USE_TESTNET = process.env.GATSBY_USE_TESTNET === 'true';
const USE_LOCAL_IPFS = process.env.GATSBY_USE_LOCAL_IPFS === 'true';
const LOCAL_IPFS_API = process.env.GATSBY_LOCAL_IPFS_API || 'http://localhost:5001';
const LOCAL_IPFS_GATEWAY = process.env.GATSBY_LOCAL_IPFS_GATEWAY || 'http://localhost:8080';

// During development/migration, we can still use local files
const USE_LOCAL_FILES = process.env.GATSBY_USE_LOCAL_FILES === 'true';

export const sourceNodes: GatsbyNode['sourceNodes'] = async ({
  actions,
  createNodeId,
  createContentDigest,
  reporter
}) => {
  const { createNode } = actions;

  if (QIP_REGISTRY_ADDRESS && (PINATA_JWT || USE_LOCAL_IPFS)) {
    // Fetch QIPs from blockchain/IPFS
    reporter.info('Fetching QIPs from blockchain and IPFS...');
    
    try {
      const qips = await sourceQIPsFromChain(
        QIP_REGISTRY_ADDRESS,
        PINATA_JWT,
        PINATA_GATEWAY,
        BASE_RPC_URL,
        USE_TESTNET,
        USE_LOCAL_IPFS,
        LOCAL_IPFS_API,
        LOCAL_IPFS_GATEWAY
      );

      reporter.info(`Fetched ${qips.length} QIPs from blockchain`);

      // Create nodes for each QIP
      for (const qip of qips) {
        const nodeContent = JSON.stringify(qip);
        const nodeMeta = {
          id: createNodeId(`qip-${qip.qipNumber}`),
          parent: null,
          children: [],
          internal: {
            type: 'QIP',
            content: nodeContent,
            contentDigest: createContentDigest(qip)
          }
        };

        const node = { ...qip, ...nodeMeta };
        createNode(node);
      }
    } catch (error) {
      reporter.error('Failed to fetch QIPs from blockchain:', error as Error);
      reporter.warn('Falling back to local files if available');
    }
  }

  if (USE_LOCAL_FILES) {
    reporter.info('Using local QIP files (migration mode enabled)');
  }
};

export const createSchemaCustomization: GatsbyNode['createSchemaCustomization'] = ({ actions }) => {
  const { createTypes } = actions;
  
  const typeDefs = `
    type QIP implements Node {
      qipNumber: Int!
      title: String!
      network: String!
      status: String!
      author: String!
      implementor: String!
      implementationDate: String!
      proposal: String!
      created: String!
      content: String!
      ipfsUrl: String!
      contentHash: String!
      version: Int!
    }
  `;
  
  createTypes(typeDefs);
};

export const createPages: GatsbyNode['createPages'] = async ({ graphql, actions, reporter }) => {
  const { createPage } = actions;

  // Query for QIPs from blockchain
  const qipResult = await graphql<{
    allQip: {
      nodes: Array<{
        qipNumber: number;
        title: string;
      }>;
    };
  }>(`
    query {
      allQip {
        nodes {
          qipNumber
          title
        }
      }
    }
  `);

  if (qipResult.errors) {
    reporter.panicOnBuild('Error loading QIPs from blockchain', qipResult.errors);
    return;
  }

  // Create pages for blockchain QIPs
  qipResult.data?.allQip.nodes.forEach((qip) => {
    createPage({
      path: `/qips/QIP-${qip.qipNumber}`,
      component: path.resolve('./src/pages/qips/QIP-blockchain.tsx'),
      context: {
        qipNumber: qip.qipNumber
      }
    });
  });

  // Create a catch-all route for dynamic QIPs (handles QIPs created after build)
  createPage({
    path: '/qips/*',
    component: path.resolve('./src/pages/qips/[qipNumber].tsx'),
    matchPath: '/qips/QIP-:qipNumber'
  });

  // Also handle markdown files during migration
  if (USE_LOCAL_FILES) {
    const markdownResult = await graphql<{
      allMarkdownRemark: {
        nodes: Array<{
          frontmatter: {
            qip: number;
          };
        }>;
      };
    }>(`
      query {
        allMarkdownRemark(filter: { frontmatter: { qip: { ne: null } } }) {
          nodes {
            frontmatter {
              qip
            }
          }
        }
      }
    `);

    if (markdownResult.errors) {
      reporter.panicOnBuild('Error loading markdown QIPs', markdownResult.errors);
      return;
    }

    markdownResult.data?.allMarkdownRemark.nodes.forEach((node) => {
      createPage({
        path: `/qips/QIP-${node.frontmatter.qip}`,
        component: path.resolve('./src/pages/qips/QIP-{MarkdownRemark.frontmatter__qip}.tsx'),
        context: {
          frontmatter__qip: node.frontmatter.qip
        }
      });
    });
  }
};