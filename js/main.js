// Elements on the page
let helpLine;
let commandLine;
let resultsContainer;
let memoryMonitor;
let sourceTemplate;
let listContainer;

// The timeout that's reset every keypress to prevent searching too quickly
let searchDebounce;

// The master results object
let results = {};

// The lunr instance used to index results
let index = lunr(function() {
  this.ref('uid');
  this.field('name');
  this.field('value');
});

/**
 * Search for a given string
 * @param {boolean} forced - If the search should be debounced
 * @returns void
 */
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

/**
 * The callback for an XHR request
 * @callback xhrcallback
 * @param {XMLHttpRequest} xhr The completed request
 */

/**
 * Makes an HTTP request using XHR
 * @param {String} url The url to send the request to
 * @param {xhrcallback} cb The callback once the request is completed
 * @param {Object} headers The headers that should be added to the request
 * @param {String} method  The method the request should use
 * @param {String} post The post data to send in the request
 * @param {String} contenttype The content type of the post request
 * @returns void
 * @description Based off  shimondoodkin's tinyxhr module
 * @link https://gist.github.com/shimondoodkin/4706967 tinyxhr
 */
function XHR(url,cb,headers,method,post,contenttype) {
  var requestTimeout,xhr;
  try{ xhr = new XMLHttpRequest(); }catch(e){
    try{ xhr = new ActiveXObject("Msxml2.XMLHTTP"); }catch (e){
      if(console)console.log("XMLHttpRequest not supported, get a better browser scrub");
      return null;
    }
  }
  requestTimeout = setTimeout(function() {xhr.abort(); cb(xhr); }, 30000);
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

/**
 * Adds a source to the sources list
 * @param {String} sourceId The source's identifier
 * @param {Object} sourceObject The source itself
 * @returns void
 */
function addSource(sourceId, sourceObject) {
  let sourceElem = sourceTemplate.content.cloneNode(true); // Clone the source template

  // Change the values to the actual source's values
  sourceElem.getElementById('sourceId').id = String(sourceId);
  sourceElem.getElementById('sourceTitle').innerHTML = sourceObject.title;
  sourceElem.getElementById('sourceTitle').href = sourceObject.url;
  sourceElem.getElementById('sourcePic').src = sourceObject.icon;
  sourceElem.getElementById('sourceTerms').innerHTML = `${Object.keys(sourceObject.data).length} Terms`;

  // Add the handler for deleting the source
  sourceElem.getElementById('closeButton').onclick = function() {
    delete results[sourceId];
    appendIndex(results);

    document.getElementById(sourceId).remove();
  };

  // Puts the source in the source list
  listContainer.appendChild(sourceElem);
}

/**
 * Resets the lunr index to an object
 * @param {Object} object 
 * @retruns void
 */
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

/**
 * @typedef {Term}
 * @property {String} name The name of the term
 * @property {String} definition The definition of the term 
 */

/**
 * Gets a term by its unique id
 * @param {String} uid The terms unique identifier
 * @returns {Term} The term object
 */
function getTerm(uid) {
  let address = uid.split('.');
  return results[address[0]].data[address[1]];
}

/**
 * Gets the current usage of the JavaScript heap
 * @returns {String} The amount of space used in the largest size multiple
 */
function getMemoryUsage() {
  let size = window.performance.memory.usedJSHeapSize;

  if (size / 1024**3 >= 1) return `${Math.floor(size * 100 / 1024**3) / 100} GBs`;
  if (size / 1024**2 >= 1) return `${Math.floor(size * 100 / 1024**2) / 100} MBs`;
  if (size / 1024**1 >= 1) return `${Math.floor(size * 100 / 1024**1) / 100} KBs`;
  return `${bytes} Bytes`;
}

/**
 * Queries the server to get the results for a search
 * @param {String} string The string to query
 * @returns void
 */
function query(string) {
  commandLine.disabled = true; // Disable the command line
  
  // Send the query to the server
  XHR('/query', function(xhr) {

    // Handle query timeouts
    if (xhr.status === 0) {
      helpLine.innerHTML = 'The query request to the server timed out.';
      commandLine.disabled = false;
      commandLine.focus();
  
      return;
    }

    // Handle 400 and 500 errors
    if (xhr.status === 400 || xhr.status === 500) {
      helpLine.innerHTML = 'There was an error processing the query.';
      commandLine.disabled = false;
      commandLine.focus();
  
      console.warn(xhr.responseText);
      
      return;
    }

    // Handle sucessfully getting an accepted response
    if (xhr.status === 202) {
      XHR(xhr.responseText, poll);
    }
  }, {query: string});
}

/**
 * Handles checking up on the job until it's completed
 * @param {XMLHttpRequest} xhr 
 */
function poll(xhr) {
  // Handle query timeouts
  if (xhr.status === 0) {
    helpLine.innerHTML = 'The query request to the server timed out.';
    commandLine.disabled = false;
    commandLine.focus();

    return;
  }
  
  // Handle 400 and 500 errors
  if (xhr.status === 400 || xhr.status === 500) {
    helpLine.innerHTML = 'There was an error processing the query.';
    commandLine.disabled = false;
    commandLine.focus();

    console.warn(xhr.responseText);

    return;
  }

  // If the job is still processing wait a second and poll again
  if (xhr.status === 202) {
    setTimeout(function() {
      XHR(JSON.parse(xhr.responseText).uri, poll);
    }, 1000);

    return;
  }

  // If the job has completed call the response function with the results
  if (xhr.status === 200) {
    response(JSON.parse(xhr.responseText).results);

    return;
  }

  // If some weird shit happened then let the user know
  helpLine.innerHTML = 'Okay, some weird shit happened. Check your console.';
  commandLine.disabled = false;
  commandLine.focus();

  console.warn('unknown response status', xhr.status);
  console.warn(xhr.responseText);
}

/**
 * Handles gettinga a response back from the server
 * @param {Object} data The response object
 */
function response(data) {
  let savedSoruces = Object.keys(results); // The sources saved in results
  let dataSources = Object.keys(data); // The sources in the new results

  // Remove any sources that already exist
  let newSources = dataSources.filter(id => !savedSoruces.includes(id));

  // For every new source add the source to the results
  newSources.forEach(function(id) {
    addSource(id, data[id]);
  });  

  // Add the data to the results object
  appendIndex(Object.assign(results, data));

  // Tell the user the query is done
  helpLine.innerHTML = 'Query completed!';

  // Search for what they typed in (forced so there's no waiting)
  search(true);

  // Re-enable the command line and focus it
  commandLine.disabled = false;
  commandLine.focus();
}

// Handle the general setup of things when the page loads
window.onload = function() {
  // Define all the elements
  helpLine = document.getElementById('helpLine');
  commandLine = document.getElementById('commandLine');
  resultsContainer = document.getElementById('resultsContainer');
  memoryMonitor = document.getElementById('memoryMonitor');
  sourceTemplate = document.getElementById('sourceTemplate');
  listContainer = document.getElementById('listContainer');

  // Handle setting up the search on key up
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

  // Set up the interval for changing the memory usage box
  setInterval(function() {
    memoryMonitor.innerHTML = `Currently using around ${getMemoryUsage()}`;
  }, 1000);
};
