var fs = require('fs');
var paths = require('path');
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
  readers[row.ip] = row.name;
},()=>{console.log(readers);});
db.each("SELECT rfid, name FROM rfid_names ORDER BY rowid", function(err, row) {
  rfid_names[row.rfid] = row.name;
  rfid_count++;
},()=>{console.log(rfid_names);});
};
const o2kvp = function(o,key="key",value="value") {
  var a=[];
  for(var k in o)
  {
    var row = {};
    row[key] = k;
    row[value] = o[k];
    a.push(row);
  }
  return a;
}
const linkify = function(keylink,text,params) {
  if(keylink&&typeof(keylink)=="function")
    return '<a href="'+keylink.call(this,params?params:txt)+'">' + text + "</a>";
  else if(keylink)
    return '<a href="'+keylink+text+'">' + text + "</a>";
  return text;
};
const tablify = function(arr, keylink) {
  if(typeof(arr)=="string") return arr;
  if(typeof(arr)=="number") return arr;
  if(typeof(arr)=="function") return arr.toString();
  var h="<table border=1>";
  if(Array.isArray(arr))
  {
    h += "<thead><tr>";
    for(var col in arr[0])
      h += "<th>"+col+"</th>";
    h += "</tr></thead>";
    h += "<tbody>";
    for(var r=0;r<arr.length;r++)
    {
      h += "<tr>";
      for(var col in arr[r])
      {
        h += "<td>";
        if(keylink&&typeof(keylink)=="function")
          h += '<a href="'+keylink.call(this,arr[r][col],arr[r])+'">';
        else if(keylink)
          h += '<a href="'+keylink+k+'">';
        h += tablify(arr[r][col]);
        if(keylink)
          h += '</a>';
        h += "</td>";
      }
      h += "</tr>";
    }
    h += "</tbody>";
  } else if(typeof(arr)=="object")
  {
    for(var k in arr)
    {
      h += "<tr><td>";
      h += linkify(keylink, k, arr);
      h += "</td><td>";
      h += tablify(arr[k]) + "</td></tr>";
    }
  }
  h += "</table>";
  return h;
}
    
refresh_data();

const types = {ico:"image/x-icon",css:"text/css",js:"text/javascript",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg"};

const requestListener = function (req, res) {
//   debug(req.connection);

  const url = purl.parse(req.url,true);
  const send_missing = function(){res.writeHead(404,"Not Found");res.end();return true;};

  let ip = req.connection.remoteAddress;
  if(ip=="::1") ip = "127.0.0.1";
  if(ip.indexOf(":")>-1)
  {
    var last = ip.substr(ip.lastIndexOf(":")+1);
    if(last.length>4) ip = last;
//     else ip = ip.substr(ip.indexOf(":"));
  }
  debug("Request: "+req.url+" from " + ip);
  //console.log(JSON.stringify(req.headers));

  if(req.url.startsWith("/assets/")||req.url=="/favicon.ico")
  {
    var path = paths.join(paths.resolve("."),req.url);
    var type = path.substr(path.lastIndexOf(".")+1);
    var ctype = types[type] || "text/"+type;
    fs.stat(path, (err,stats) => {
      if(err||!stats) return send_missing();
      var s = fs.createReadStream(path);
      res.writeHead(200,{
        "Content-Type":ctype
        ,"Content-Length":stats.size
        ,"Last-Modified":new Date(stats.mtime).toGMTString()
        ,"Keep-Alive":"close"
        });
      s.on('error',()=>send_missing);
      s.pipe(res);
    });
    return;
  }

  const send_json = function(j,more) {
    res.writeHead(200,{"Content-Type":"application/json"});
    res.write(JSON.stringify(j));
    res.write("\n");
    if(!more)
      res.end();
    return true;
  }
  const send_plain = function(s,more) {
    res.writeHead(200,{"Content-Type":"text/plain"});
    res.write(s);
    if(!s.endsWith("\n"))
      res.write("\n");
    if(!more)
      res.end();
    return true;
  }
  const send_redir = function(l) {
    res.writeHead(302,{"Location":l});
    res.end();
    return true;
  }
  const send_error = function(msg,code=500) {
    res.writeHead(code);
    res.write(msg);
    if(!msg.endsWith("\n"))
      res.write("\n");
    res.end();
    return true;
  }
  const send_head = function(opts={}) {
    opts.type=opts.type||"text/html";
    res.writeHead(200,{"Content-Type":opts.type});
    res.write("<html><head><title>Tool Check"+(opts.title?": "+opts.title:"")+"</title>");
    res.write('<link rel="stylesheet" type="text/css" href="/assets/styles.css">');
//     res.write('<style>body{background-color: #cdcdcd;padding:0;margin:0;}#wrapper{min-height:100%;max-width:6in;padding:.5in 1in;margin:0 auto;background-color: white;border-left:1px solid black;border-right:1px solid black;}</style>');
    res.write("</head><body>");
    res.write('<div id="wrapper">');
    if(opts.title)
      res.write('<h1>'+opts.title+'</h1>');
  }
  const send_foot = function() {
    res.write('</div>');
    res.write("</body></html>");
    res.end();
    return true;
  }
  const send_input = function(name,opts,more=true){
    opts=opts||{};
    if(!opts.type) opts.type="text";
    if(!opts.name) opts.name=name;
    if(!more) send_head();
    if(opts.label)
    {
      res.write("<label>");
      if(opts.type!="checkbox")
        res.write(opts.label);
    }
    res.write('<input ');
    for(var k in opts)
      if(k!="label")
        res.write(k+'="'+opts[k]+'" ');
    res.write('/>');
    if(opts.label)
    {
      if(opts.type=="checkbox")
        res.write(opts.label);
      res.write("</label>");
    }
    if(!more) res.end();
    return true;
  }
  const send_form = function(action,opts,more=false){
    if(!more)
      send_head(opts);
    res.write('<form action="'+action+'">');
    var inputs = opts.inputs || opts;
    var submit = false;
    for(var key in inputs)
    {
      if(inputs[key].type=="submit") submit = true;
      send_input(key,inputs[key],true);
    }
    if(!submit)
      send_input("submit",{label:" ",type:"submit",value:"Update"});
    res.write('</form>');
    if(!more)
      res.end();
  }

  if(url.pathname=="/")
  {
    send_head();
    
    if(url.query.msg)
      res.write("<marquee>"+url.query.msg+"</marquee><br>");
    res.write("<h2>Readers</h2>\n");
    res.write(tablify(o2kvp(readers,"ip","name"),(a,b)=>"/rename?ip="+(b&&b.ip?b.ip:a)));
    res.write("\n<h2>RFIDs</h2>\n");
    res.write(tablify(o2kvp(rfid_names,"rfid","name"),(a,b)=>"/rename?rfid="+(b&&b.rfid?b.rfid:a)));
    return send_foot();
  } else if(url.pathname=="/rename")
  {
    if(url.query.ip&&!url.query.name)
    {
      var name = readers[url.query.ip];
      send_form("/rename",{title:"Rename Reader",inputs:{"ip":{type:"hidden",value:url.query.ip},"name":{type:"input",value:name,label:"Enter name for [" + url.query.ip + "]: "}}});
    }
    if(url.query.ip&&url.query.name)
    {
      if(!readers[url.query.ip])
        return send_redir("/?msg=Bad+Reader");
      db.run("UPDATE readers SET name = ? WHERE ip = ?", [url.query.name, url.query.ip], refresh_data);
    }
    if(url.query.rfid&&!url.query.name)
    {
      var name = rfid_names[url.query.rfid];
      send_form("/rename",{title:"Rename Tool",inputs:{"rfid":{type:"hidden",value:url.query.rfid},"name":{type:"input",value:name,label:"Enter name for [" + url.query.rfid + "]: "}}});
    }
    if(url.query.rfid&&url.query.name)
    {
      if(!rfid_names[url.query.rfid])
      {
        db.run("INSERT INTO rfid_names (name, rfid) VALUES (?, ?)", [url.query.name, url.query.rfid], refresh_data);
        return send_redir("/");
        //return send_redir("/?msg=Bad+RFID");
      } else {
        db.run("UPDATE rfid_names SET name = ? WHERE rfid = ?", [url.query.name, url.query.rfid], refresh_data);
        rfid_names[url.query.rfid] = url.query.name;
      }
    }
    return send_redir("/");
  } else if(url.pathname=="/refresh")
  {
    refresh_data();
    return send_redir("/");
  } else if(url.pathname=="/dump")
  {
    return send_json({readers:readers,rfid_names:rfid_names});
  } else if(url.pathname=="/log")
  {
    db.all("SELECT l.rfid, t.name as rfid_name, t.name as reader_name, l.stamp "+
      "FROM rfid_log l LEFT JOIN rfid_names t ON t.rfid = l.rfid "+
      "LEFT JOIN readers r ON r.ip = l.ip ORDER BY l.rowid DESC",[],function(err,rows){
      if(err) console.error(err);
      if(rows)
        send_json(rows);
      else send_json([]);
    });
  }
  
  ///// API SECTION /////
  let reader = readers[ip];
  if(!reader)
  {
    reader_count++;
    readers[ip] = {ip:ip};
    var name = "reader " + reader_count;
    readers[ip].name = name;
    reader = readers[ip];
    db.run("INSERT INTO readers (ip, name) VALUES (?, ?)",[ip,name]);
    db.get("SELECT * FROM readers WHERE ip = ?", [ip], function(err,row){if(row)reader=row;});
  }
  const check_rfid = function(rfid,name=false) {
    if(name) // replace
    {
      db.run("REPLACE INTO rfid_names (rfid, name) VALUES (?, ?)", [rfid, name]);
      debug("Add/replace ["+rfid+"] as [" + name + "]");
      return;
    } else name = rfid_names[rfid];
    if(!name)
    {
      rfid_count++;
      name = rfid_names[rfid] = "tool " + rfid_count;
      db.run("INSERT INTO rfid_names (rfid, name) VALUES (?, ?)", [rfid, name]);
    }
    let present = !url.query.checkout;
    db.run("INSERT INTO rfid_log (readerid, rfid, ip, present) VALUES (?, ?, ?, ?)",
      [reader.rowid, rfid, ip, present]);
    debug("Received [" + rfid + "] as [" + name + "]");
  //   speak("Thank you for returning " + name);
  }
  if(url.pathname=="/checkin")
  {
    return send_plain(reader.name);
  } else if(url.pathname=="/rfid")
  {
    let rfid = '';
    if(url.query.rfid) {
      check_rfid(url.query.rfid,url.query.name);
      return send_plain("Thanks");
    }
    req.on("data", chunk => {
      rfid += chunk;
    });
    req.on("end",()=>{
      if(!rfid) send_error("Need RFID");
      check_rfid(rfid);
      return send_plain("Thanks");
    });
  } else {
    return send_error("Dunno",400);
  }
}

debug("Starting server");

const server = http.createServer(requestListener);
server.listen(8080);

debug("Ready!");

