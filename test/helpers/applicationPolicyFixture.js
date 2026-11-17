const fs=require('node:fs'),path=require('node:path');
const {loadApplicationPolicy,runWithApplicationPolicy}=require('../../src/applicationReleasePolicy');
const base=path.resolve(__dirname,'../fixtures/application-policy');
function fixturePolicy(){process.env.RELEASE_PUBLISHER_TEST_MODE='true';return loadApplicationPolicy(base,'latest');}
function enterFixturePolicy(){
  // Test-process scope only. The production loader always requires the candidate's own file.
  require('../../src/applicationReleasePolicy').enterTestPolicy(fixturePolicy());
}
function seedApplicationPolicy(root){
  const policy=JSON.parse(fs.readFileSync(path.join(base,'release/publisher/game-policy.json'),'utf8'));
  for(const file of ['release/publisher/game-policy.json',...policy.inputs]){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(base,file),target);}
}
module.exports={fixturePolicy,enterFixturePolicy,seedApplicationPolicy};
