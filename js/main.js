let helpLine;
let commandLine;
let resultsContainer;
let memoryMonitor;
let sourceTemplate;
let listContainer;

let searchDebounce;

let results = {};
let index = lunr(function() {
  this.ref('uid');
  this.field('name');
  this.field('value');
});

function search(forced) {
  if (searchDebounce) clearTimeout(searchDebounce);

  if (!forced) helpLine.innerHTML = 'Searching...'
  searchDebounce = setTimeout(function(string = commandLine.value) {
    let matches = index.search(string);

    resultsContainer.innerHTML = matches.map(match => {
      let term = getTerm(match.ref);
  
      return `<font color="red">Term:</font><br>${term.name}<br><br><font color="dodgerblue">Definition:</font><br>${term.value}`;
    }).join('<br><br><br><br>');
  
    if (matches.length > 0) {
      helpLine.innerHTML = `Done! Found ${matches.length} results.`;
    } else {
      helpLine.innerHTML = 'No results found, press ENTER twice to search online.';
    }
  }, forced?0:250);
}

function XHR(url,cb,headers,method,post,contenttype) {
  var requestTimeout,xhr;
  try{ xhr = new XMLHttpRequest(); }catch(e){
    try{ xhr = new ActiveXObject("Msxml2.XMLHTTP"); }catch (e){
      if(console)console.log("XMLHttpRequest not supported, get a better browser scrub");
      return null;
    }
  }
  requestTimeout = setTimeout(function() {xhr.abort(); cb(xhr); }, 10000);
  xhr.onreadystatechange = function() {
    if (xhr.readyState != 4) return;
    clearTimeout(requestTimeout);
    cb(xhr);
  };
  xhr.open(method?method.toUpperCase():"GET", url, true);

  for (let header in headers) xhr.setRequestHeader(header, headers[header]);

  if(!post) xhr.send();
  else {
    xhr.setRequestHeader('Content-type', contenttype?contenttype:'application/x-www-form-urlencoded');
    xhr.send(post);
  }
}

function addSource(sourceId, sourceObject) {
  let sourceElem = sourceTemplate.content.cloneNode(true);

  sourceElem.getElementById('sourceId').id = String(sourceId);
  sourceElem.getElementById('sourceTitle').innerHTML = sourceObject.title;
  sourceElem.getElementById('sourceTitle').href = sourceObject.url;
  sourceElem.getElementById('sourcePic').src = sourceObject.icon;
  sourceElem.getElementById('sourceTerms').innerHTML = `${Object.keys(sourceObject.data).length} Terms`;

  sourceElem.getElementById('closeButton').onclick = function() {
    delete results[sourceId];
    appendIndex(results);

    document.getElementById(sourceId).remove();
  };

  listContainer.appendChild(sourceElem);
}

function appendIndex(object) {
  index = lunr(function() {
    this.ref('uid');
    this.field('name');
    this.field('value');

    for (let pageId in object) {
      for (let termId in object[pageId].data) {
        this.add(object[pageId].data[termId]);
      }
    }
  });
}

function getTerm(uid) {
  let address = uid.split('.');
  return results[address[0]].data[address[1]];
}

function getMemoryUsage() {
  let size = window.performance.memory.usedJSHeapSize;

  if (size / 1024**3 >= 1) return `${Math.floor(size * 100 / 1024**3) / 100} GBs`;
  if (size / 1024**2 >= 1) return `${Math.floor(size * 100 / 1024**2) / 100} MBs`;
  if (size / 1024**1 >= 1) return `${Math.floor(size * 100 / 1024**1) / 100} KBs`;
  return `${bytes} Bytes`;
}

function query(string) {
  commandLine.disabled = true;
  XHR('/query', function(xhr) {
    if (xhr.status === 0) {
      helpLine.innerHTML = 'The query request to the server timed out.';
      commandLine.disabled = false;
      commandLine.focus();
  
      return;
    }

    if (xhr.status === 400 || xhr.status === 500) {
      helpLine.innerHTML = 'There was an error processing the query.';
      commandLine.disabled = false;
      commandLine.focus();
  
      console.warn(xhr.responseText);
      
      return;
    }

    if (xhr.status === 202) {
      XHR(xhr.responseText, poll);
    }
  }, {query: string});
}

function poll(xhr) {
  if (xhr.status === 0) {
    helpLine.innerHTML = 'The query request to the server timed out.';
    commandLine.disabled = false;
    commandLine.focus();

    return;
  }
  
  if (xhr.status === 400 || xhr.status === 500) {
    helpLine.innerHTML = 'There was an error processing the query.';
    commandLine.disabled = false;
    commandLine.focus();

    console.warn(xhr.responseText);

    return;
  }

  if (xhr.status === 202) {
    setTimeout(function() {
      XHR(JSON.parse(xhr.responseText).uri, poll);
    }, 1000);

    return;
  }

  if (xhr.status === 200) {
    response(JSON.parse(xhr.responseText).results);

    return;
  }

  helpLine.innerHTML = 'Okay, some weird shit happened. Check your console.';
  commandLine.disabled = false;
  commandLine.focus();

  console.warn('unknown response status', xhr.status);
  console.warn(xhr.responseText);
}

function response(data) {
  let savedSoruces = Object.keys(results);
  let dataSources = Object.keys(data);

  let newSources = dataSources.filter(id => !savedSoruces.includes(id));

  newSources.forEach(function(id) {
    addSource(id, data[id]);
  });  

  appendIndex(Object.assign(results, data));

  helpLine.innerHTML = 'Query completed!';

  search(true);

  commandLine.disabled = false;
  commandLine.focus();
}

window.onload = function() {
  helpLine = document.getElementById('helpLine');
  commandLine = document.getElementById('commandLine');
  resultsContainer = document.getElementById('resultsContainer');
  memoryMonitor = document.getElementById('memoryMonitor');
  sourceTemplate = document.getElementById('sourceTemplate');
  listContainer = document.getElementById('listContainer');

  commandLine.onkeyup = function(e) {
    if (e.key === 'Enter' && commandLine.value.length > 0) {
      if (searchPrimed) {
        helpLine.innerHTML = 'Querying server, this may take a few seconds...'
        searchPrimed = false;

        query(commandLine.value);
      } else {
        helpLine.innerHTML = 'Press ENTER again to do an online search, this DOES count to the query limit!';
        searchPrimed = true;
      }

      return;
    } else searchPrimed = false;

    search();
  };

  setInterval(function() {
    memoryMonitor.innerHTML = `Currently using around ${getMemoryUsage()}`;
  }, 1000);
};