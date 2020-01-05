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

const crc = string => crc32(string).toString(16);

class Job {

  query;
  id;
  uri;
  status = 'PENDING';
  resolve;



  // Creates the job with a job id, stores it in the jobs object, and sets its status to PENDING
  constructor(query) {
    this.query = query;
    this.id = +new Date;
    this.uri = `/job/${this.id}`;

    jobs[this.id] = this;
  }



  // Starts the job by searching for the query
  start() {
    this.status = 'STARTED';

    googleSearch(this.query, (function(error, result) {
      if (error != null) return this._error(error);

      this._process(
        result.data.items.map(item => item.cacheId),
        result.data.items.map(item => item.link)
      );
    }).bind(this));

    return this.id;
  }



  // Processes the results of the search by requesting then parsing
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
      .catch(this._error.bind(this));
  }



  // Puts the results in the correct return format and then completes the job
  _complete(ids, results) {
    this.results = {};

    results.forEach((function(result, index) {
      for (let crc in result.data) {
        result.data[crc].uid = `${ids[index]}.${crc}`;
      }

      this.results[ids[index]] = result;
    }).bind(this));

    this.status = 'COMPLETED';
  }



  // Handles all job errors
  _error(error) {
    this.status = 'ERRORED';
    this.error = error;

    console.log('error', error);
  }
}



// Preforms a search using google's custom search API
function googleSearch(query, callback) {
  search.cse.list({
    q: query,
    cx: process.env.CUSTOM_SEARCH_ENGINE_ID,
    key: process.env.CUSTOM_SEARCH_API_KEY
  }, callback);
}

// Parses HTML response data and extract important information to return
function parse(host, uri, body) {
  let dom = new JSDOM(body);

  switch(host) {
    case 'quizlet.com':
      let data = {};
      let cards = dom.window.document.querySelectorAll('div.SetPageTerm-content');
      let title = dom.window.document.querySelector('.UIHeading--one');

      cards.forEach(function(card) {
        let word = card.querySelector('a.SetPageTerm-wordText > span.TermText').innerHTML;
        let definition = card.querySelector('a.SetPageTerm-definitionText > span.TermText').innerHTML;

        data[crc(word)] = {
          name: word,
          value: definition
        };
      });

      return {
        source: host,
        icon: icons[host],
        url: uri,
        data: data,
        title: title.innerHTML
      }
    break;
  }
}

app.get('/', (req, res) => res.sendFile('/html/index.html', {root: __dirname}));
app.get('/fonts/main', (req, res) => res.sendFile('/fonts/BreeSerif.otf', {root: __dirname}));
app.get('/lunr.js', (req, res) => res.sendFile('/js/lunr.js', {root: __dirname}));
app.get('/main.js', (req, res) => res.sendFile('/js/main.js', {root: __dirname}));
app.get('/favicon.ico', (req, res) => res.sendFile('/img/favicon.png', {root: __dirname}));

app.get('/query', (req, res) => {
  if (req.headers.query) {
    let jobid = new Job(req.headers.query).start();

    res.status(202).send(`/job/${jobid}`);
  } else res.sendStatus(400);
});

app.get('/job/:jobid', (req, res) => {
  let job = jobs[req.params.jobid];

  if (job) {
    switch(job.status) {
      
      case 'PENDING':
      case 'STARTED':
      case 'PROCESSING':

        res.status(202).send(JSON.stringify(job));
      break;

      case 'COMPLETED':
        res.status(200).send(JSON.stringify(job));
      break;

      case 'ERRORED':
        res.status(500).send(JSON.stringify(job));
      break;

      default:
        res.sendStatus(500);
    }
  } else res.sendStatus(400);
});

app.listen(process.env.PORT || 80, () => {
  console.log(`Server is running on port ${process.env.PORT || 80}`);
});
