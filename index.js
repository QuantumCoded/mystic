const url = require('url');

const express = require('express');
const app = express();

const rp = require('request-promise');

const { google } = require('googleapis');
const { JSDOM } = require('jsdom');
const { crc32 } = require('crc');

const search = google.customsearch('v1');

const jobs = {};
const icons = {
  'quizlet.com': 'https://quizlet.com/a/i/brandmark/1024.893fa7e00da6339.png'
};

/**
 * Calculates the crc32 for a given string
 * @param {String} string The string to calculate crc for
 * @returns {String} The crc of the input string
 */
const crc = string => crc32(string).toString(16);

/** The Job class */
class Job {

  query;
  id;
  uri;
  status = 'PENDING';
  resolve;



  /**
   * Creates a job with an id, stores it in the jobs object, and becomes PENDING
   * @param {String} query The search query the job was spawned from
   * @returns {Job}
   */
  constructor(query) {
    this.query = query;
    this.id = +new Date;
    this.uri = `/job/${this.id}`;

    jobs[this.id] = this;
  }



  /**
   * Starts a job after it has been created
   * @returns {Number} jobId
   */
  start() {
    this.status = 'STARTED';

    googleSearch(this.query, (function(error, result) {
      if (error != null) return this._error(60, error);

      this._process(
        result.data.items.map(item => item.cacheId),
        result.data.items.map(item => item.link)
      );
    }).bind(this));

    return this.id;
  }



  /**
   * Processes the results of the search by requesting then parsing
   * @param {String[]} ids The cache ids of the sites to process
   * @param {String[]} sites The URLs of the sites to process
   * @returns void
   */
  _process(ids, sites) {
    this.status = 'PROCESSING';

    let promiseArray = sites.map(uri => 
      rp({
        url: uri,
        transform: function(body) {
          return parse(
            url.parse(uri).host,
            uri,
            body
          );
        }
      })
    );

    Promise.all(promiseArray)
      .then((function(parsedArray) {
        this._complete(ids, parsedArray)
      }).bind(this))
      .catch(this._error.bind(99, this));
  }



  /**
   * Puts the results in the correct return format and completes the job
   * @param {String[]} ids 
   * @param {Source[]} results
   * @returns void
   */
  _complete(ids, results) {
    this.results = {};

    results = results.filter(result => result); // Remove empty results

    results.forEach((function(result, index) {
      for (let crc in result.data) {
        result.data[crc].uid = `${ids[index]}.${crc}`;
      }

      this.results[ids[index]] = result;
    }).bind(this));

    this.status = 'COMPLETED';
  }



  /**
   * Handles all job errors
   * @param {Error} error
   * @returns void
   */
  _error(error, line) {
    this.status = 'ERRORED';
    this.error = error;

    console.log(line, 'error', error);
  }
}

/** 
 * The callback of a google search
 * @callback googleSearchResponse
 * @param {Object} error
 * @param {Object} result
 */

/**
 * Preforms a search using google's custom search API
 * @param {String} query The search query
 * @param {googleSearchResponse} callback The callback when the search has completed
 * @returns void
 */
function googleSearch(query, callback) {
  search.cse.list({
    q: query,
    cx: process.env.CUSTOM_SEARCH_ENGINE_ID,
    key: process.env.CUSTOM_SEARCH_API_KEY
  }, callback);
}

/** 
 * @typedef {Object} Result
 * @property {String} name The name of the result
 * @property {String} value The value of the result
 */

/**
 * @typedef {Object} Results
 * @enum {Result}
 */

/**
 * @typedef {Object} Source
 * @property {String} source The hostname of the source
 * @property {String} icon The URL of the source's icon
 * @property {String} url The URI of the source
 * @property {Results} data The results from the source
 * @property {String} title The title of the source
 */

/**
 * Parses HTML response data and extracts important information
 * @param {String} host The host of the page the request was made to
 * @param {String} uri The URI of the page 
 * @param {String} body The response body
 * @returns {Source} The source itself
 */
function parse(host, uri, body) {
  let dom = new JSDOM(body);

  switch(host) {

    // Handle parsing quizlet pages
    case 'quizlet.com':
      let data = {}; // Create the data object

      // Grab the card and title elements
      let cards = dom.window.document.querySelectorAll('div.SetPageTerm-content');
      let title = dom.window.document.querySelector('.UIHeading--one');

      // For every card try and parse a word and definition
      cards.forEach(function(card) {
        let wordElem = card.querySelector('a.SetPageTerm-wordText > span.TermText'); // Grab the word element
        let definitionElem = card.querySelector('a.SetPageTerm-definitionText > span.TermText'); // Grab the definition element
        
        // Define the word and definition only if they exist
        let word = wordElem && wordElem.innerHTML;
        let definition = definitionElem && definitionElem.innerHTML;

        // If neither exist don't try and add it to the data object
        if (!word || !definition) return;
        
        // Generate a UID for the term and add it to the data object
        data[crc(word)] = {
          name: word,
          value: definition
        };
      });

      // Return undefined if there is no terms (will be caught in Job.prototype._complete)
      if (Object.keys(data).length === 0) return;

      // Return the formatted source object
      return {
        source: host,
        icon: icons[host],
        url: uri,
        data: data,
        title: title && title.innerHTML || 'No Title'
      }
    break;
  }
}

// Make the files accessable
app.get('/', (req, res) => res.sendFile('/html/index.html', {root: __dirname}));
app.get('/fonts/main', (req, res) => res.sendFile('/fonts/BreeSerif.otf', {root: __dirname}));
app.get('/lunr.js', (req, res) => res.sendFile('/js/lunr.js', {root: __dirname}));
app.get('/main.js', (req, res) => res.sendFile('/js/main.js', {root: __dirname}));
app.get('/favicon.ico', (req, res) => res.sendFile('/img/favicon.png', {root: __dirname}));

// Handle query requests
app.get('/query', (req, res) => {
  if (req.headers.query) {
    let jobid = new Job(req.headers.query).start(); // Create and start a new job

    res.status(202).send(`/job/${jobid}`); // Tell the client the job had been started
  } else res.sendStatus(400); // If there's no query, the request was bad
});

// Handle job requests
app.get('/job/:jobid', (req, res) => {
  let job = jobs[req.params.jobid]; // Get the job being requested

  // If the job exists then handle sending back job data
  if (job) {
    switch(job.status) {
      
      // If the job is PENDING, STARTED, or PROCESSING, then send back the current job with a 202 (Accepted)
      case 'PENDING':
      case 'STARTED':
      case 'PROCESSING':

        res.status(202).send(JSON.stringify(job));
      break;

      // If the job is COMPLETED send back the job with a 200 (OK) to signify it's finished
      case 'COMPLETED':
        res.status(200).send(JSON.stringify(job));
      break;

      // If the job has ERRORED send back the job with a 500 (Internal Server Error) to let them know it's on our end
      case 'ERRORED':
        res.status(500).send(JSON.stringify(job));
      break;

      // If the job status is unkown for whatever reason it's also a 500 (Internal Server Error)
      default:
        res.sendStatus(500);
    }
  } else res.sendStatus(400); // If the job dosen't exist, bad request
});

// Bind the application to the correct port
app.listen(process.env.PORT || 80, () => {
  console.log(`Server is running on port ${process.env.PORT || 80}`);
});