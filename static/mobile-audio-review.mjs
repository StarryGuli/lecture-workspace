// Reassemble original contiguous sound, never the gate's retained snippets.
// Boundaries are existing speech endpoints, not fixed-duration cuts.
export function reviewGroups(rows,parts,{maxSeconds=600,maxFrames=16000*900}={}) {
  const known=new Map(parts.map(p=>[p.seq,p])),groups=[];let group=null;
  for(const row of [...rows].sort((a,b)=>a.seq-b.seq)){
    const part=known.get(row.seq);
    if(!part||part.skipped||part.segments?.some(s=>s.unprocessed)) {group=null;continue;}
    if(!group||Math.abs(group.end-row.start)>.002||group.rows.at(-1).seq+1!==row.seq||group.end-group.start>=maxSeconds||(group.end-group.start+row.duration)*16000>maxFrames){
      group={start:row.start,end:row.start,rows:[]};groups.push(group);
    }
    group.rows.push(row);group.end=row.start+row.duration;
  }
  return groups;
}
