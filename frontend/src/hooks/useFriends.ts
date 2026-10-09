import {useCallback,useEffect,useState} from 'react';
import type {Socket} from 'socket.io-client';
import {api,post} from '../lib/api';
import type {Friendship,FriendsList} from '../lib/types';
const empty:FriendsList={friends:[],incoming:[],outgoing:[]};
// Friends and friend requests, refreshed whenever the server says they changed.
export function useFriends(socket:Socket|null){
  const [list,setList]=useState<FriendsList>(empty);
  const load=useCallback(()=>{void api<FriendsList>('/friends').then(setList).catch(()=>{});},[]);
  useEffect(()=>{if(!socket)return;load();socket.on('friends:changed',load);socket.on('connect',load);return()=>{socket.off('friends:changed',load);socket.off('connect',load);};},[socket,load]);
  const relation=useCallback((id:string):Friendship=>list.friends.some(f=>f.id===id)?'friends':list.incoming.some(f=>f.id===id)?'incoming':list.outgoing.some(f=>f.id===id)?'outgoing':'none',[list]);
  const run=async(action:Promise<unknown>)=>{await action;load();};
  return {...list,relation,reload:load,
    send:(userId:string)=>run(post('/friends/requests',{userId})),
    accept:(userId:string)=>run(post(`/friends/requests/${userId}/accept`)),
    decline:(userId:string)=>run(api(`/friends/requests/${userId}`,{method:'DELETE'})),
    remove:(userId:string)=>run(api(`/friends/${userId}`,{method:'DELETE'}))};
}
export type FriendsState=ReturnType<typeof useFriends>;
