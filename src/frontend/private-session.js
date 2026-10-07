export const privateSessionDefaults = Object.freeze({idleMinutes:30,backgroundMinutes:2});
export const privateIdleChoices = [5,15,30,60,120];
export const privateBackgroundChoices = [0,1,2,5,10];
export const privateSessionStorageKey = 'lector.private-session.v1';
export function normalizePrivateSession(value={}) {
  return {
    idleMinutes:privateIdleChoices.includes(value?.idleMinutes)?value.idleMinutes:30,
    backgroundMinutes:privateBackgroundChoices.includes(value?.backgroundMinutes)?value.backgroundMinutes:2
  };
}

// Solo se persisten tiempos. La clave de la bóveda permanece en memoria.
export function createPrivateSession({lock,mask=()=>{},now=Date.now,schedule=setTimeout,cancel=clearTimeout,preferences=privateSessionDefaults}) {
  let policy=normalizePrivateSession(preferences),active=false,hidden=false,lastActivity=0,hiddenAt=0,timer;
  const deadline=()=>Math.min(lastActivity+policy.idleMinutes*60000,hidden?hiddenAt+policy.backgroundMinutes*60000:Infinity);
  function stop(){active=false;cancel(timer);timer=undefined;mask(false);}
  function check(){if(active&&now()>=deadline()){stop();lock();return false;}return active;}
  function arm(){cancel(timer);if(check())timer=schedule(arm,Math.max(1,deadline()-now()));}
  return {
    start({isHidden=false}={}){stop();active=true;hidden=isHidden;lastActivity=hiddenAt=now();mask(hidden);arm();},
    stop,
    activity(){if(!check()||hidden)return;lastActivity=now();arm();},
    visibility(isHidden){if(!check())return;hidden=Boolean(isHidden);if(hidden)hiddenAt=now();mask(hidden);arm();},
    configure(value){policy=normalizePrivateSession(value);arm();return policy;},
    check,
    preferences:()=>({...policy})
  };
}
