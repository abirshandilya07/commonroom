import {useEffect,useRef,useState} from 'react';
import {Send,Trash2} from 'lucide-react';
import {formatDuration} from '../lib/media';
const MAX_SECONDS=300;
const BARS=28;
// Records a voice note with a live level animation; resolves with the audio when sent.
export default function VoiceRecorder({onSend,onCancel,onError}:{onSend:(file:Blob,duration:number)=>void;onCancel:()=>void;onError:(message:string)=>void}) {
  const [seconds,setSeconds]=useState(0),[levels,setLevels]=useState<number[]>(()=>Array(BARS).fill(0.08));
  const recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]),started=useRef(0),sendOnStop=useRef(false);
  const callbacks=useRef({onSend,onCancel,onError});callbacks.current={onSend,onCancel,onError};
  useEffect(()=>{
    let stream:MediaStream|null=null,audio:AudioContext|null=null,frame=0,tick:ReturnType<typeof setInterval>|undefined,cancelled=false;
    (async()=>{
      try{
        if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Voice recording is not supported in this browser.');
        stream=await navigator.mediaDevices.getUserMedia({audio:true});
        if(cancelled){stream.getTracks().forEach(t=>t.stop());return;}
        const type=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t));
        const rec=new MediaRecorder(stream,type?{mimeType:type}:undefined);recorder.current=rec;
        rec.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data);};
        rec.onstop=()=>{
          const duration=(Date.now()-started.current)/1000;
          if(sendOnStop.current&&chunks.current.length)callbacks.current.onSend(new Blob(chunks.current,{type:(rec.mimeType||'audio/webm').split(';')[0]}),duration);
        };
        rec.start(250);started.current=Date.now();
        tick=setInterval(()=>{const s=(Date.now()-started.current)/1000;setSeconds(s);if(s>=MAX_SECONDS){sendOnStop.current=true;rec.stop();}},200);
        audio=new AudioContext();const analyser=audio.createAnalyser();analyser.fftSize=256;audio.createMediaStreamSource(stream).connect(analyser);
        const data=new Uint8Array(analyser.frequencyBinCount);
        const draw=()=>{analyser.getByteTimeDomainData(data);let peak=0;for(const v of data)peak=Math.max(peak,Math.abs(v-128)/128);const idle=0.15+0.25*Math.abs(Math.sin(Date.now()/140))*Math.random();setLevels(l=>[...l.slice(1),Math.min(1,Math.max(idle,peak*2.5))]);frame=requestAnimationFrame(draw);};
        draw();
      }catch(e){
        const denied=e instanceof DOMException&&e.name==='NotAllowedError';
        callbacks.current.onError(denied?'Microphone access was blocked. Allow it in your browser’s site settings to record voice notes.':e instanceof Error?e.message:'Could not start recording.');
        callbacks.current.onCancel();
      }
    })();
    return()=>{cancelled=true;cancelAnimationFrame(frame);clearInterval(tick);if(recorder.current?.state==='recording')recorder.current.stop();stream?.getTracks().forEach(t=>t.stop());void audio?.close();};
  },[]);
  const finish=(send:boolean)=>{sendOnStop.current=send;if(recorder.current?.state==='recording')recorder.current.stop();if(!send)callbacks.current.onCancel();};
  return <div className="flex items-center gap-3 px-3 py-3" role="status" aria-label="Recording voice note">
    <button type="button" aria-label="Discard recording" className="icon-button" onClick={()=>finish(false)}><Trash2 size={17}/></button>
    <span className="relative flex h-3 w-3 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75"/><span className="relative inline-flex h-3 w-3 rounded-full bg-red-500"/></span>
    <span className="w-10 shrink-0 text-xs font-semibold tabular-nums">{formatDuration(seconds)}</span>
    <div aria-hidden className="flex h-8 min-w-0 flex-1 items-center gap-[3px] overflow-hidden">{levels.map((level,i)=><span key={i} className="w-[3px] shrink-0 rounded-full bg-accent transition-[height] duration-100" style={{height:`${Math.round(level*100)}%`}}/>)}</div>
    <button type="button" aria-label="Send voice note" className="primary-button rounded-md px-3 py-2" onClick={()=>finish(true)}><Send size={15}/><span className="hidden text-xs sm:inline">Send</span></button>
  </div>;
}
