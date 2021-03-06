// This updater function is based off of Sick-Beard by midgetspy.
// View their work at https://github.com/midgetspy/Sick-Beard.

var exec		= require('child_process').exec
  , schedule	= require('node-schedule')
  , when		= require('when')
  , paths		= require('./paths')
  , log			= require(paths.logger)('UPDATER');

function Updater(app) {
	if(!(this instanceof Updater)) {
		return new Updater(app);
	}

	this.allowChecks	= app.config.checkForUpdates;
	this.enabled		= false;
	this.app			= app;
	this._currentHash	= null;
	this._newestHash	= null;
	this.updateObj		= false;
	this.schedule		= false;

	if(this.allowChecks) {
		this.enable();
	}
};

Updater.prototype.enable = function() {
	if(this.enabled) return;

	var self = this;
	this._getDetails().then(function() {
		self.allowChecks = true;
		//self.checkForUpdate();

		if(self.schedule) self.schedule.cancel();

		self.schedule = schedule.scheduleJob('0 1,13 * * *', function() {
    		self.checkForUpdate();
		});
	});
};

Updater.prototype.updateMsg = function() {
	return (this.updateObj) ? this.formatMsg() : false;
};

Updater.prototype.formatMsg = function(obj) {
	var git = obj ? obj : this.updateObj;

	var url = ['https://github.com', this._gitRepoUser, this._gitRepo, 'compare', git.current + '...' + git.newest].join('/');

	var msg = 'There is a <a href="' + url + '" target="_blank">newer version available</a>';
	    msg += ' (you\'re ' + git.behind + ' commit' + ((git.behind > 1) ? 's' : '') + ' behind)';
	    msg += ' &mdash; <a href="' + this.getUpdateUrl() + '">Update Now</a>';

	return msg;
};

Updater.prototype.getUpdateUrl = function() {
	return this.app.config.webRoot + '/update/' + process.pid;
};

Updater.prototype.cmd = function(args, gitPath) {
	var promise = when.defer();

	var cmd = ((gitPath) ? gitPath : this._gitPath) + ' ' + args;

	log.debug('Executing', cmd.yellow, 'with your shell in', this.app.dir.yellow)
	exec(cmd, function(err, output, errMsg) {
		if(err) {
			errMsg = errMsg.trim();
			log.error('Git command', cmd.yellow, 'didn\'t work. Returned:', err.message);
			return promise.reject();
		}

		output = output.trim();
		log.debug('Git command', cmd.yellow, ' successfully returned:', output.cyan);
		promise.resolve(output);
	});

	return promise.promise;
};

Updater.prototype._getDetails = function() {
	var self = this;
	return this._findWorkingGit().then(function(gitPath) {
		self._gitPath		= gitPath;
		self._gitRepoUser	= 'lienma';
		self._gitRepo		= 'UpsBoard';

		return self._getBranch().then(function(branch) {
			self.branch		= branch;
		});

	}).otherwise(function(reason) {

console.log('Bad:', reason);
	});
};

Updater.prototype._findWorkingGit = function() {
	var promise = when.defer();

	var testCmd = 'version';
	var gitPath = (this.app.config.gitPath) ? this.app.config.gitPath : 'git';

	log.debug('Checking if we can use git commands:', gitPath, testCmd.yellow);
	this.cmd(testCmd, gitPath).then(function(data) {
		promise.resolve(gitPath);
	}).otherwise(function(reason) {
console.log('Failed 1');
	});

	return promise.promise;
};

Updater.prototype._getBranch = function() {
	return this.cmd('symbolic-ref -q HEAD').then(function(data) {
		var branch = data.replace('refs/heads/', '');
		return when.resolve(branch);
	});
};

Updater.prototype._getInstalledVersion = function() {
	var self = this;
	return this.cmd('rev-parse HEAD').then(function(output) {
		if(!/[a-z0-9]+/.test(output)) {
			log.error('Output doesn\'t look like a hash, not using it.');
			return when.reject(false);
		}
		
		self._currentHash = output;
		return when.resolve(output);
	});
};

Updater.prototype._getGithubVersion = function() {
	var promise = when.defer()
	  , self = this
	  , newestHash = null
	  , commitsBehind = 0
	  , commitsAhead = 0;

	this.cmd('fetch origin').then(function() {
		self.cmd('rev-parse --verify --quiet "@{upstream}"').then(function(output) {
			newestHash = output.trim();
			if(!/[a-z0-9]+/.test(newestHash)) {
				log.error('Output doesn\'t look like a hash, not using it.');
				return when.reject(false);
			}
			self._newestHash = newestHash;

			self.cmd('rev-list --left-right "@{upstream}"...HEAD').then(function(output) {
				commitsBehind = parseInt(output.length - output.replace(new RegExp('<', 'g'), '').length);
				commitsAhead = parseInt(output.length - output.replace(new RegExp('>', 'g'), '').length);


				promise.resolve({
					hash: newestHash,
					behind: commitsBehind,
					ahead: commitsAhead
				});
			}).otherwise(function(reason) {
				log.debug('Git didn\'t return numbers for behind and ahead, not using it.');
			});
		}).otherwise(function(reason) {
			log.debug('Git didn\'t return newest commit hash.');
			promise.reject(false);
		});
	}).otherwise(function(reason) {
		log.error('Unable to contact github, can\'t check for update.');
		promise.reject(false);
	});

	return promise.promise;
};

Updater.prototype.checkForUpdate = function() {
	log.info('Checking to see if UpsBoard needs an update.');

	var self = this;
	when.all([this._getInstalledVersion(), this._getGithubVersion()]).then(function(results) {
		if(results[1].behind > 0) {
			return when.resolve({
				current: results[0],
				newest: results[1].hash,
				behind: results[1].behind,
				ahead: results[1].ahead
			});
		} else {
			log.info('There is no new update available.');
			return when.resolve(false);
		}
	}).then(function(needUpdate) {
		if(needUpdate) {
			log.debug('There is an update available!');
		}

		self.updateObj = needUpdate;
	});
};

Updater.prototype.doUpdate = function() {
	return this.cmd('pull origin ' + this.branch).then(function() {
		console.log('RESTART:' + process.pid);
	});
};

module.exports = Updater;
