import type { GatsbyConfig } from "gatsby";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config({
  path: `.env`,
});

console.log("📋 Gatsby Config - Environment Variables Check:");
console.log("- GATSBY_QIP_REGISTRY_ADDRESS:", process.env.GATSBY_QIP_REGISTRY_ADDRESS);
console.log("- GATSBY_USE_LOCAL_IPFS:", process.env.GATSBY_USE_LOCAL_IPFS);
console.log("- GATSBY_PINATA_JWT:", process.env.GATSBY_PINATA_JWT ? "✅ Set" : "❌ Not set");
console.log("- GATSBY_BASE_RPC_URL:", process.env.GATSBY_BASE_RPC_URL);

const config: GatsbyConfig = {
  siteMetadata: {
    title: `QIPs`,
    siteUrl: `https://www.yourdomain.tld`,
  },
  // More easily incorporate content into your pages through automatic TypeScript type generation and better GraphQL IntelliSense.
  // If you use VSCode you can also use the GraphQL plugin
  // Learn more at: https://gatsby.dev/graphql-typegen
  graphqlTypegen: true,
  plugins: [
    "gatsby-plugin-postcss",
    "gatsby-plugin-image",
    "gatsby-plugin-sitemap",
    {
      resolve: "gatsby-plugin-manifest",
      options: {
        icon: "src/images/icon.png",
      },
    },
    "gatsby-plugin-mdx",
    "gatsby-plugin-sharp",
    "gatsby-transformer-sharp",
    {
      resolve: "gatsby-source-filesystem",
      options: {
        name: "images",
        path: "./src/images/",
      },
      __key: "images",
    },
    {
      resolve: "gatsby-source-filesystem",
      options: {
        name: "pages",
        path: "./src/pages/",
      },
      __key: "pages",
    },
    {
      resolve: "gatsby-source-filesystem",
      options: {
        name: "contents",
        path: "./contents",
      },
      __key: "contents",
    },
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        name: `markdown-pages`,
        path: `${__dirname}/contents/static`,
      },
    },
    `gatsby-transformer-remark`,
  ],
};

export default config;
