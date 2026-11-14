const normalized=s=>{const chars=[],ends=[];let offset=0;for(const ch of String(s)){offset+=ch.length;if(/[\p{L}\p{N}]/u.test(ch)){chars.push(ch.toLowerCase());ends.push(offset);}}return {chars,ends};};
// Match an old acoustic transcript to the prefix of a revised one. The result
// selects text for question detection; it does not assert word timestamps.
export function acousticDelta(previous,current){
 const a=normalized(previous),b=normalized(current);
 if(a.chars.length<8||a.chars.length>8000||b.chars.length>12000)return null;
 let row=Uint32Array.from({length:b.chars.length+1},(_,i)=>i);
 for(let i=1;i<=a.chars.length;i++){
  const next=new Uint32Array(row.length);next[0]=i;
  for(let j=1;j<row.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a.chars[i-1]!==b.chars[j-1]));
  row=next;
 }
 const lo=Math.max(1,Math.floor(a.chars.length*.6)),hi=Math.min(b.chars.length,Math.ceil(a.chars.length*1.4));let end=lo;
 for(let j=lo;j<=hi;j++)if(row[j]<row[end]||row[j]===row[end]&&Math.abs(j-a.chars.length)<Math.abs(end-a.chars.length))end=j;
 const difference=row[end]/a.chars.length;if(!Number.isFinite(difference)||difference>.2)return null;
 let cut=b.ends[end-1]||0;
 while(cut<current.length&&/[\s，。！？,.!?；;：:]/.test(current[cut]))cut++;
 return {prefix:current.slice(0,cut),text:current.slice(cut),difference,cut};
}

// New acoustic requests consume at most 3x the successfully processed source
// duration. Short frequent utterances therefore cannot grow costs quadratically.
export function allowAcousticContext({sentSeconds,sourceSeconds,nextSeconds,blockSeconds}){
 return blockSeconds<=900&&sentSeconds+blockSeconds+nextSeconds<=(sourceSeconds+nextSeconds)*3+.002;
}
export function visibleAcousticParts(parts){const replaced=new Set(parts.flatMap(p=>p.replacedSequences||[]));return parts.filter(p=>!replaced.has(p.seq));}
