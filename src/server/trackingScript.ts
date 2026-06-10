/**
 * Returns a lightweight inline <script> tag that auto-tracks engagement
 * events and POSTs them to the tracking endpoint.
 *
 * Must be injected just before </body> in the rendered proposal HTML.
 */
export function buildTrackingScript(token: string): string {
  const endpoint = `/api/view/${encodeURIComponent(token)}/track`;
  return `<script>
(function(){
  var TOKEN=${serializeForInlineScript(token)};
  var EP=${serializeForInlineScript(endpoint)};
  var viewerId;
  try{viewerId=sessionStorage.getItem("sf_vid")}catch(e){}
  if(!viewerId){viewerId="v-"+Math.random().toString(36).slice(2,10);try{sessionStorage.setItem("sf_vid",viewerId)}catch(e){}}

  function post(evt,extra){
    var body={event:evt,ts:new Date().toISOString(),viewerId:viewerId};
    if(extra){for(var k in extra){if(extra.hasOwnProperty(k))body[k]=extra[k]}}
    try{navigator.sendBeacon(EP, new Blob([JSON.stringify(body)],{type:"application/json"}))}catch(e){
      try{var xhr=new XMLHttpRequest();xhr.open("POST",EP,true);xhr.setRequestHeader("Content-Type","application/json");xhr.send(JSON.stringify(body))}catch(e2){}
    }
  }

  // 1. Page view
  post("viewed");

  // 2. Time-on-page (sent periodically and on unload, capped at 30 minutes)
  var startTime=Date.now();
  var MAX_TIME_ON_PAGE_SECONDS=1800;
  var timeInterval=setInterval(function(){
    var elapsed=Math.round((Date.now()-startTime)/1000);
    if(elapsed>MAX_TIME_ON_PAGE_SECONDS){clearInterval(timeInterval);return}
    post("time_on_page",{duration:elapsed});
  },30000);

  // 3. Section visibility via IntersectionObserver
  var sectionTime={};
  var sectionStart={};
  if(typeof IntersectionObserver!=="undefined"){
    var sections=document.querySelectorAll("section[data-page]");
    var observer=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        var id=entry.target.getAttribute("data-page");
        if(!id)return;
        if(entry.isIntersecting){
          sectionStart[id]=Date.now();
        }else if(sectionStart[id]){
          var dur=Math.round((Date.now()-sectionStart[id])/1000);
          sectionTime[id]=(sectionTime[id]||0)+dur;
          post("section_view",{section:id,duration:dur});
          delete sectionStart[id];
        }
      });
    },{threshold:0.3});
    for(var i=0;i<sections.length;i++){observer.observe(sections[i])}
  }

  // 4. Pricing focus detection
  var pricingEl=document.querySelector('[data-page="investment-next-steps"]');
  if(pricingEl&&typeof IntersectionObserver!=="undefined"){
    var pricingObserver=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          pricingObserver.disconnect();
          post("pricing_focus",{section:"investment-next-steps"});
        }
      });
    },{threshold:0.5});
    pricingObserver.observe(pricingEl);
  }

  // Flush on page unload
  window.addEventListener("beforeunload",function(){
    clearInterval(timeInterval);
    for(var id in sectionStart){
      if(sectionStart.hasOwnProperty(id)){
        var dur=Math.round((Date.now()-sectionStart[id])/1000);
        sectionTime[id]=(sectionTime[id]||0)+dur;
        post("section_view",{section:id,duration:dur});
      }
    }
    var elapsed=Math.round((Date.now()-startTime)/1000);
    post("time_on_page",{duration:elapsed});
  });
})();
</script>`;
}

/**
 * Serialize a string for embedding inside an inline <script>. JSON.stringify
 * handles quoting/escaping; `<` is additionally escaped so a value containing
 * `</script>` can never terminate the script element.
 */
function serializeForInlineScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
