/* Script.js
 *  Script object
 */

//Define key commands in script editor (ctrl x to close, etc.)
$(document).keydown(function(e) {
	if (Engine.currentPage == Engine.Page.ScriptEditor) {
		//Ctrl + x
        if (e.keyCode == 88 && e.ctrlKey) {			
			var filename = document.getElementById("script-editor-filename").value;
			
			if (checkValidFilename(filename) == false) {
				postScriptEditorStatus("Script filename can contain only alphanumerics, hyphens, and underscores");
				return;
			}
			
			filename += ".script";
			
			//If the current script matches one thats currently running, throw an error
			for (var i = 0; i < Player.getCurrentServer().runningScripts.length; i++) {
				if (filename == Player.getCurrentServer().runningScripts[i].filename) {
					postScriptEditorStatus("Cannot write to script that is currently running!");
					return;
				}
			}
			
			//If the current script already exists on the server, overwrite it
			for (var i = 0; i < Player.getCurrentServer().scripts.length; i++) {
				if (filename == Player.getCurrentServer().scripts[i].filename) {
					Player.getCurrentServer().scripts[i].saveScript();
					Engine.loadTerminalContent();
					return;
				}
			}
			
			//If the current script does NOT exist, create a new one
			var script = new Script();
			script.saveScript();
			Player.getCurrentServer().scripts.push(script);
			Engine.loadTerminalContent();
        }
	}
});

//Checks that the string contains only valid characters for a filename, which are alphanumeric,
// underscores and hyphens
function checkValidFilename(filename) {
	var regex = /^[a-zA-Z0-9_-]+$/;
	
	if (filename.match(regex)) {
		return true;
	}
	return false;
}

var ScriptEditorLastStatus = null;
function postScriptEditorStatus(text) {
	document.getElementById("script-editor-status").innerHTML = text;
	
	clearTimeout(ScriptEditorLastStatus);
	ScriptEditorLastStatus = setTimeout(function() {
		document.getElementById("script-editor-status").innerHTML = "";
	}, 3000);
}

function Script() {    
	this.filename 	= "";
    this.code       = "";
    this.ramUsage   = 0;
	this.server 	= "";	//IP of server this script is on
    
    /* Properties to calculate offline progress. Only applies for infinitely looping scripts */
    
    //Number of instructions ("lines") in the code. Any call ending in a ; 
    //is considered one instruction. Used to calculate ramUsage
    this.numInstructions        = 0;
	
	//Stats to display on the Scripts menu, and used to determine offline progress
	this.offlineRunningTime  	= 0;	//Seconds
	this.offlineMoneyMade 		= 0;
	this.offlineExpGained 		= 0;
	this.onlineRunningTime 		= 0;	//Seconds
	this.onlineMoneyMade 		= 0;
	this.onlineExpGained 		= 0;
	
};

//Get the script data from the Script Editor and save it to the object
Script.prototype.saveScript = function() {
	if (Engine.currentPage == Engine.Page.ScriptEditor) {
		//Update code and filename
		var code = document.getElementById("script-editor-text").value;
		this.code = code;
		
		var filename = document.getElementById("script-editor-filename").value + ".script";
		this.filename = filename;
		
		//Server
		this.server = Player.currentServer;
		
		//Calculate/update number of instructions, ram usage, execution time, etc. 
		this.updateNumInstructions();
		this.updateRamUsage();
		
		//Clear the stats when the script is updated
		this.offlineRunningTime  	= 0;	//Seconds
		this.offlineMoneyMade 		= 0;
		this.onlineRunningTime 		= 0;	//Seconds
		this.onlineMoneyMade 		= 0;
		this.lastUpdate				= 0;
	}
}

//Calculates the number of instructions, which is just determined by number of semicolons
Script.prototype.updateNumInstructions = function() {
	var numSemicolons = this.code.split(";").length - 1;
	this.numInstructions = numSemicolons;
}

//Updates how much RAM the script uses when it is running.
//Right now, it is determined solely by the number of instructions
//Ideally, I would want it to be based on type of instructions as well
// 	(e.g. hack() costs a lot but others dont)
Script.prototype.updateRamUsage = function() {
	this.ramUsage = this.numInstructions * .2;
}

Script.prototype.toJSON = function() {
    return Generic_toJSON("Script", this);
}

Script.fromJSON = function(value) {
    return Generic_fromJSON(Script, value.data);
}

Reviver.constructors.Script = Script;


//Called when the game is loaded. Loads all running scripts (from all servers)
//into worker scripts so that they will start running
loadAllRunningScripts = function() {
	var count = 0;
	for (var property in AllServers) {
		if (AllServers.hasOwnProperty(property)) {
			var server = AllServers[property];
			
			//Reset each server's RAM usage to 0
			server.ramUsed = 0;
			
			for (var j = 0; j < server.runningScripts.length; ++j) {
				count++;
				//runningScripts array contains only names, so find the actual script object
				var script = server.getScript(server.runningScripts[j]);
				if (script == null) {continue;}
				addWorkerScript(script, server);
				
				//Offline production
				scriptCalculateOfflineProduction(script);
			}
		}
	}
	console.log("Loaded " + count.toString() + " running scripts");
}

scriptCalculateOfflineProduction = function(script) {
	//The Player object stores the last update time from when we were online
	var thisUpdate = new Date().getTime();
	var lastUpdate = Player.lastUpdate;
	var timePassed = (thisUpdate - lastUpdate) / 1000;	//Seconds
	console.log("Offline for " + timePassed.toString() + " seconds");
	
	//Calculate the "confidence" rating of the script's true production. This is based
	//entirely off of time. We will arbitrarily say that if a script has been running for
	//120 minutes (7200 sec) then we are completely confident in its ability
	var confidence = (script.onlineRunningTime) / 7200;
	if (confidence >= 1) {confidence = 1;}
	console.log("onlineRunningTime: " + script.onlineRunningTime.toString());
	console.log("Confidence: " + confidence.toString());
	
	//A script's offline production will always be at most half of its online production.
	var production = (1/2) * (script.onlineMoneyMade / script.onlineRunningTime) * timePassed;
	production *= confidence; 
	
	var expGain = (1/2) * (script.onlineExpGained / script.onlineRunningTime) * timePassed;
	expGain *= confidence;
	
	//Account for production in Player and server
	Player.gainMoney(production);
	Player.hacking_exp += expGain;
	
	var server = AllServers[script.server];
	server.moneyAvailable -= production;
	if (server.moneyAvailable < 0) {server.moneyAvailable = 0;}
	
	//Update script stats
	script.offlineMoneyMade += production;
	script.offlineRunningTime += timePassed;
	script.offlineExpGained += expGain;
		
	//DEBUG
	var serverName = AllServers[script.server].hostname;
	console.log(script.filename + " from server " + serverName + " generated $" + production.toString() + " while offline");
}