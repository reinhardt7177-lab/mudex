import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpClient } from '../app/higgsfield.mjs';
test('cloud OAuth uses public callback, rejects bad state, and stores token after exchange', async () => {
  let origin, registered;
  const provider=http.createServer(async (req,res)=>{
    let body='';for await(const chunk of req) body+=chunk;
    res.setHeader('Content-Type','application/json');
    if(req.url.includes('oauth-protected-resource')) res.end(JSON.stringify({resource:origin+'/mcp',authorization_servers:[origin]}));
    else if(req.url.includes('oauth-authorization-server')) res.end(JSON.stringify({authorization_endpoint:origin+'/authorize',registration_endpoint:origin+'/register',token_endpoint:origin+'/token'}));
    else if(req.url==='/register') {registered=JSON.parse(body);res.end(JSON.stringify({client_id:'public-client'}));}
    else if(req.url==='/token') {assert.equal(new URLSearchParams(body).get('redirect_uri'),'https://mudex.example/oauth/callback/test');res.end(JSON.stringify({access_token:'test-access',expires_in:3600}));}
    else {res.statusCode=404;res.end('{}');}
  });
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  origin=`http://127.0.0.1:${provider.address().port}`;
  try {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mudex-oauth-'));
    const client=new McpClient(dir,{url:origin+'/mcp',key:'test',publicBase:'https://mudex.example'});
    const login=new URL(await client.startLogin());
    assert.equal(login.searchParams.get('redirect_uri'),'https://mudex.example/oauth/callback/test');
    assert.deepEqual(registered.redirect_uris,['https://mudex.example/oauth/callback/test']);
    await assert.rejects(client.completeLogin(new URL('https://mudex.example/oauth/callback/test?code=x&state=wrong')), /state|상태/);
    assert.equal(client.loggedIn,false);
    const done=client.pendingLogin.done;
    await client.completeLogin(new URL(`https://mudex.example/oauth/callback/test?code=x&state=${login.searchParams.get('state')}`));
    await done;
    assert.equal(client.loggedIn,true);
    assert.equal(client.pendingLogin,null);
  } finally { provider.closeAllConnections();await new Promise(r=>provider.close(r)); }
});
