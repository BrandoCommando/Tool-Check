const http = require('http');
const purl = require('url');
const { exec } = require("child_process");
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('rfid.db');

let readers = {};
let reader_count = 0;
let rfid_names = {};
let rfid_count = 0;
const start = new Date().getTime();

const speak = function(str) {
  exec("flite -voice slt -t \"" + str + "\"");
};

const debug = function(str) {
  //let diff = new Date().getTime() - start;
  let now = new Date();
  let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  console.log(//now.getYear() + "-" + now.getMonth() + "-" + now.getDate() + " " +
    h + ":" + (m<10?"0":"") + m + ":" + (s<10?"0":"") + s + ": " +
    str);
}

//*
db.serialize(function() {
  db.run("CREATE TABLE IF NOT EXISTS readers (ip TEXT UNIQUE, name TEXT, stamp TEXT DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS rfid_names (rfid TEXT UNIQUE, name TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS rfid_log (rfid TEXT, readerid INTEGER, present INTEGER DEFAULT 1, ip TEXT, stamp TEXT DEFAULT CURRENT_TIMESTAMP)");
});
//*/
const refresh_data = function() {
readers = {};
reader_count = 0;
rfid_names = {};
rfid_count = 0;
db.each("SELECT * FROM readers ORDER BY rowid", function(err, row) {
  readers[row.ip] = row;
},()=>{console.log(readers);});
db.each("SELECT rfid, name FROM rfid_names ORDER BY rowid", function(err, row) {
  rfid_names[row.rfid] = row.name;
  rfid_count++;
},()=>{console.log(rfid_names);});
};

refresh_data();

const requestListener = function (req, res) {
//   debug(req.connection);
  const url = purl.parse(req.url,true);
  var ip = req.connection.remoteAddress;
  if(ip.indexOf(":")>-1)
    ip = ip.substr(ip.lastIndexOf(":")+1);
  let reader = readers[ip];
  if(!reader)
  {
    reader_count++;
    readers[ip] = {ip:ip};
    var name = "reader " + reader_count;
    readers[ip].name = name;
    reader = readers[ip];
    db.run("INSERT INTO readers (ip, name) VALUES (?, ?)",[ip,name]);
    db.get("SELECT * FROM readers WHERE ip = ?", [ip], function(err,row){reader=row;});
  }
  debug("Request: "+req.url+" from "+reader.name+" ("+ip+")");
  if(url.pathname=="/")
  {
    res.writeHead(200,{"Content-Type":"text/html"});
    if(url.query.msg)
      res.write("<marquee>"+url.query.msg+"</marquee><br>");
    res.write("TODO");
    res.end();
  }
  if(url.pathname=="/checkin")
  {
    res.writeHead(200,{"Content-Type":"text/plain"});
    res.end(reader.name);
  } else if(url.pathname=="/rename")
  {
    if(url.query.ip&&url.query.name)
    {
      if(!readers[url.query.ip])
      {
        res.writeHead(302,{"Location":"/?msg=Bad+Reader"});
        res.end();
        return;
      }
      db.run("UPDATE readers SET name = ? WHERE ip = ?", [url.query.name, url.query.ip], refresh_data);
    }
    if(url.query.rfid&&url.query.name)
    {
      if(!rfid_names[url.query.rfid])
      {
        res.writeHead(302,{"Location":"/?msg=Bad+RFID"});
        res.end();
        return;
      } else
      {
        db.run("UPDATE rfid_names SET name = ? WHERE rfid = ?", [url.query.name, url.query.rfid]);
        rfid_names[url.query.rfid] = url.query.name;
      }
    }
    res.writeHead(302,{"Location":"/"});
    res.end();
  } else if(url.pathname=="/refresh")
  {
    refresh_data();
    res.writeHead(302,{"Location":"/"});
    res.end();
  } else if(url.pathname=="/rfid")
  {
    res.writeHead(200,{"Content-Type":"text/plain"});
    let rfid = '';
    req.on("data", chunk => {
      rfid+=chunk;
    });
    req.on("end",()=>{
      var name = rfid_names[rfid];
      if(!name)
      {
        rfid_count++;
        name = rfid_names[rfid] = "tool " + rfid_count;
        db.run("INSERT INTO rfid_names (rfid, name) VALUES (?, ?)", [rfid, name]);
      }
      let present = !url.query.checkout;
      db.run("INSERT INTO rfid_log (readerid, rfid, ip, present) VALUES (?, ?, ?, ?)",
        [reader.rowid, rfid, ip, present]);
      debug("Received: " + rfid);
      speak("Thank you for returning " + name);
      res.end("Thanks");
    });
  } else {
    res.writeHead(200,{"Content-Type":"text/plain"});
    res.end('Hello, World!');
  }
}

debug("Starting server");

const server = http.createServer(requestListener);
server.listen(8080);

debug("Ready!");

