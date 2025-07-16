// src/templates/Template.tsx
import React, { useState, useEffect } from "react";
import { graphql } from "gatsby";
import Layout from "../../layout";
import FrontmatterTable from "../../components/FrontmatterTable";
import SnapshotSubmitter from "../../components/SnapshotSubmitter";

interface Props {
  frontmatter__qip: number;
  data: any;
}

const Template: React.FC<Props> = ({ data }) => {
  const { markdownRemark } = data;
  const { frontmatter, html, rawMarkdownBody } = markdownRemark;
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <Layout>
      <div className="container max-w-full">
        <div className="content mt-30 overflow-y-auto h-screen flex justify-center items-start">
          <div id="content-center" className="relative w-full pl-0 lg:w-3/4 lg:pl-5 mt-20">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-center mb-6">
                QIP-{frontmatter.qip}: {frontmatter.title}
              </h1>

              <div className="mb-6 flex flex-col items-center">
                {isClient ? (
                  <SnapshotSubmitter frontmatter={frontmatter} html={html} rawMarkdown={rawMarkdownBody} />
                ) : (
                  <div className="text-center p-4">Loading interactive module...</div>
                )}
              </div>

              <div className="flex justify-center sm:m-0 m-3">
                <FrontmatterTable frontmatter={frontmatter} />
              </div>
              <div className="markdown-content mt-3 p-3 md:p-none">
                <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Template;

export const pageQuery = graphql`
  query ($frontmatter__qip: Int) {
    markdownRemark(frontmatter: { qip: { eq: $frontmatter__qip } }) {
      fileAbsolutePath
      frontmatter {
        qip
        title
        author
        network
        proposal
        implementor
        created
        status
      }
      html
      rawMarkdownBody
    }
  }
`;
