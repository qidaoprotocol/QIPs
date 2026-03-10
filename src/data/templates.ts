export interface Template {
  id: string;
  name: string;
  description: string;
  title: string;
  chain: string;
  implementor: string;
  content: string;
}

export const templates: Template[] = [
  {
    id: 'general',
    name: 'General QCI Template',
    description: 'For protocol improvements and changes',
    title: 'General template',
    chain: 'Polygon PoS',
    implementor: 'None',
    content: `### Summary

In clear and simple terms, describe the proposal and its intended goal. This should be non-technical and accessible to a casual community member.

### Abstract

A short (~200 word) description of the proposed change, the abstract should clearly describe the proposed change. This is what will be done if the QCI is implemented, not why it should be done or how it will be done.

### Motivation

Here is where you should describe why the proposal is needed - the problem statement. It is critical that you explain why the change is needed. Please note that the solution description does not go in this section.

### Specification

[Provide detailed specification here]

### Rationale

The reasoning for the solution above should go here. Why did you propose to implement the change in this way? What were the considerations and trade-offs? The rationale fleshes out what motivated the design and why particular design decisions were made. It should describe alternate designs that were considered and related work. The rationale may also provide evidence of consensus within the community, and should discuss important objections or concerns raised during discussion.

### Technical Specification

The technical specification should outline the changes to the protocol on a technical level.

### Configurable Values

Please list all values configurable under this implementation, if applicable.`
  },
  {
    id: 'new-asset',
    name: 'New Asset Template',
    description: 'For adding new collateral assets to QiDAO',
    title: 'Add [Asset Name] as Collateral',
    chain: 'Polygon PoS',
    implementor: 'None',
    content: `### Summary

Describe the asset and its key attributes.

### Security

Detail any centralization vectors, such as minting rights, and dependencies.

### Vault specifications:

* **Collateral asset to be used:** [Asset name and contract address]
* **Minimum collateral to debt ratio:** [e.g., 125%]
* **Fees:** [repayment fee / interest rate fee / performance fee on asset / minting fee]
* **Minimum debt:** [ ] MAI
* **Maximum debt:** [ ] MAI
* **Oracle provider:** [e.g., Chainlink]
* **Risk grading:** [To be determined]
* **Risk methodology:** [Risk Analysis Rubric](https://docs.google.com/spreadsheets/d/1uvRFiN5FNr4OUKdsueFbnrQhx1lMdf1FfXRw1tnIXJE/edit?usp=sharing)

### Motivation

Explain the expected value-add to QiDao.

### Quorum Standards

The option with the most votes will be adopted

### Options

* Approve proposal
* Further discussions needed
* Abstain`
  }
];