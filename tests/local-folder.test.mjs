import test from 'node:test';
import assert from 'node:assert/strict';
import {listFolderMedia,saveJobToFolder,conversationMarkdown} from '../ui/local-folder.js';
class Directory {
  kind='directory';constructor(name){this.name=name;this.items=new Map();}
  async *entries(){yield* this.items;}
  async getDirectoryHandle(name,{create}={}){if(!this.items.has(name)){if(!create)throw new Error('missing');this.items.set(name,new Directory(name));}return this.items.get(name);}
  async getFileHandle(name){if(!this.items.has(name))this.items.set(name,{kind:'file',name,data:null,async createWritable(){const entry=this;const stream=new WritableStream({write(data){entry.data=data;}});stream.write=async data=>{const writer=stream.getWriter();try{await writer.write(data);}finally{writer.releaseLock();}};stream.close=async()=>{const writer=stream.getWriter();try{await writer.close();}finally{writer.releaseLock();}};return stream;}});return this.items.get(name);}
  file(name,data){this.items.set(name,{kind:'file',name,async getFile(){return new File([data],name,{lastModified:1});}});}
}
test('folder import lists media with nested paths and leaves unrelated files out',async()=>{
  const folder=new Directory('work');folder.file('photo.png','image');folder.file('private.txt','secret');
  const sub=await folder.getDirectoryHandle('footage',{create:true});sub.file('clip.mp4','video');
  const saved=await folder.getDirectoryHandle('무덱스 저장',{create:true});saved.file('old.mp4','old');
  const files=await listFolderMedia(folder);
  assert.deepEqual(files.map(x=>x.relative).sort(),['footage/clip.mp4','photo.png']);
});
test('PC export saves conversation and media below a dedicated job directory and rejects traversal',async()=>{
  const folder=new Directory('work');folder.file('original.mp4','keep');
  const job={id:'stable-id',uid:'instance-1',workspace_id:'workspace-a',name:'새 이름',events:[{type:'user',text:'사진을 영상으로'},{type:'assistant',text:'완료했습니다.'}],files:[{file:'out/final.mp4',kind:'video'}]};
  assert.match(conversationMarkdown(job),/사진을 영상으로/);
  const saved=await saveJobToFolder(folder,job,async()=>new Response('video'));
  assert.ok(saved.directory.startsWith('무덱스 저장/'));assert.equal(saved.files,3);
  const root=folder.items.get('무덱스 저장').items.get(saved.directory.split('/')[1]);
  assert.match(root.items.get('대화.md').data,/완료했습니다/);
  assert.equal(folder.items.get('original.mp4').kind,'file');
  await assert.rejects(saveJobToFolder(folder,{...job,files:[{file:'../private.txt'}]},async()=>new Response('bad')),/경로/);
  const other=await saveJobToFolder(folder,{...job,workspace_id:'workspace-b'},async()=>new Response('other'));
  const recreated=await saveJobToFolder(folder,{...job,uid:'instance-2'},async()=>new Response('recreated'));
  assert.notEqual(saved.directory,other.directory);assert.notEqual(saved.directory,recreated.directory);
  assert.match(root.items.get('대화.md').data,/완료했습니다/);
});
