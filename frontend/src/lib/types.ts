import type {PublicIdentity,Envelope} from '../../../shared/crypto';
export type Status = 'online'|'dnd'|'invisible';
export type Presence = 'online'|'dnd'|'offline';
export type User = {id:string;name:string;username:string;avatarUrl?:string|null;encryptionReady?:boolean};
export type Me = User & {status:Status;joinedAt:string};
export type Profile = User & {joinedAt:string;status:Status|Presence;note:string};
export type Member = User & {identity:PublicIdentity|null;lastReadId?:number};
export type Conversation = {id:string;kind:'direct'|'group';title:string|null;createdBy:string;peer:User;members:Member[];lastMessage:string|null;lastWire?:WireMessage|null;lastMessageId:number;unreadCount:number;updatedAt:string};
export type Reaction = {emoji:string;userIds:string[]};
export type Attachment = {id:string;key:string;iv:string;mime:string;name:string;size:number;kind:'image'|'video'|'audio'|'file';duration?:number};
export type WireMessage = {id:number;conversationId:string;senderId:string;clientId:string;body?:string;encrypted:Envelope|null;legacy:boolean;createdAt:string;editedAt?:string;deleted?:boolean;reactions?:Reaction[]};
export type Message = Omit<WireMessage,'body'> & {body:string;attachment?:Attachment;decryptionError?:boolean;beforeJoin?:boolean};
export type MessagePage = {messages:WireMessage[];hasMore:boolean};
export type SendAck = {ok:true;message:WireMessage}|{ok:false;error:string};
// Common Room AI. These are not end-to-end encrypted: the AI has to read what it answers.
export type AiItemSummary = {id:string;kind:'reminder'|'task';title:string;dueAt:string|null};
export type AiMessage = {id:number;conversationId:string|null;role:'user'|'assistant';body:string;contextCount:number;askedBy:{id:string;name:string}|null;items:AiItemSummary[];createdAt:string};
export type Item = AiItemSummary & {done:boolean;createdAt:string;conversationId:string|null;conversationName:string|null};
