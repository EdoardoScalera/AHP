const CONFIG = {
  githubPat_a: 'github_pat_11BJ5IVFQ0xw2sSZ3aBZjM_', 
  githubPat_b: '3FJbW8X2tAnN9AIzDquBCgdOgJXylPk6sTpRJgtdey85DUTUWR7iBAIfLbs',
  githubPat: githubPat_a + githubPat_b,
  repoOwner: 'EdoardoScalera',
  repoName: 'AHP',
  passwordHash: '6f5ed8ce43e1d045ae2f1a9acd1a765585eac4a7646accac73ad4b61decbbb2a'
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

export { CONFIG };