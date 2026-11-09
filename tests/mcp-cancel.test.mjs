import test from 'node:test';
import assert from 'node:assert/strict';
import {MCP_TOOLS} from '../app/mcp-tools.mjs';
test('cancellation during MCP preparation cannot open a new approval or execute a call',async()=>{
  const controller=new AbortController();let asked=0,called=0;
  const connectors={async prepareCall(){controller.abort();return {approval_required:true,approval_token:'test',arguments:{}};},async call(){called++;}};
  const tool=MCP_TOOLS.find(t=>t.name==='call_mcp_tool');
  await assert.rejects(tool.run(null,{connector_id:'test',tool_name:'publish',arguments:{}},{connectors,signal:controller.signal,async ask(){asked++;return 'yes';}}),/멈/);
  assert.equal(asked,0);assert.equal(called,0);
});
