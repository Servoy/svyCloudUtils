/**
 * Method to copy all jasperreports that are located in the reports folder to the jasperreport location on the server.
 * @public 
 * @properties={typeid:24,uuid:"D9BBFECF-49BF-4F62-B2D8-A13B1234C5DB"}
 */
function copyReportsToServer() {
	var location = plugins.file.getDefaultUploadLocation().replace('uploads', '')
	var mediaFiles = solutionModel.getMediaList();
	application.output('Copying reports', LOGGINGLEVEL.DEBUG);
	for each (var media in mediaFiles) {
		if (media.getName().match(/reports/) && (media.getName().match(/jrxml/) || media.getName().match(/jasper/))) {
			plugins.file.deleteFile(location + scopes.svyIO.getFileSeperator() + media.getName());
			var file = plugins.file.createFile(location + scopes.svyIO.getFileSeperator() + media.getName());
			plugins.file.createFolder(file.getPath().replace(file.getName(), ''));
			plugins.file.writeFile(file, media.bytes);
			application.output('Writing report file: ' + file.getAbsolutePath(), LOGGINGLEVEL.DEBUG);
		}
	}
}

/**
 * @enum 
 * @properties={typeid:35,uuid:"4BE44304-B2C2-4EFD-96B5-487052500BAE",variableType:-4}
 */
var DB_IMPORT_TYPE = {
	REPEAT: 'R',
	VERSION: 'V'
}
/**
 * Method to run DB Migration on postImport with version store.
 * All SQL Files should be located in the folder `database-migration` and should be named as follow:
 * 
 * Files Starting with V are version files.. files with R are repeat files and will always execute.
 * Example Version naming V__1__dbName__myDescription
 * Example Repeat naming R__1__dbName__myDescription
 * 
 * There should be double _ between all name parts to correctly parse then, when not there the file will be ignored.
 * 
 * Files will be sorted on versionnumber and execute once when it are version files.
 * 
 * @public 
 * @properties={typeid:24,uuid:"42DEAD17-B4D8-4A09-9B78-259FC1FFC30F"}
 */
function runDBVersionUpgrade() {
	var medias = solutionModel.getMediaList();
	/**@type {Array<parseMediaDBFile>} */
	var foundVersions = [];
	/**@type {Array<parseMediaDBFile>} */
	var foundRepeats = [];
	
	//Filter all the types and select matched on naming
	for each (var media in medias) {
		var parsedFile = new parseMediaDBFile(media);
		if(parsedFile.isValidFile()) {
			if(parsedFile.type == DB_IMPORT_TYPE.VERSION) {
				foundVersions.push(parsedFile);
			} else {
				foundRepeats.push(parsedFile);
			}
		}
	}
	
	//Sort everything on versionnumber
	foundVersions.sort(sortVersion);
	foundRepeats.sort(sortVersion);
	
	var currentVersion = parseInt(getServoyProperty('DB_VERSION')||'0');
	var nextVersion = 0;
	while(foundVersions.length > 0 || foundRepeats.length > 0) {
		nextVersion++;
		if(foundVersions.length > 0) {
			var versionFile = foundVersions[0];
			if(versionFile.version == nextVersion && versionFile.version > currentVersion) {
				foundVersions.shift();
				if(!plugins.rawSQL.executeSQL(versionFile.dbServer,versionFile.getFileData())) {
					throw new Error('Failed to run migration SQL FILE: ' + versionFile.name + ' \n' + plugins.rawSQL.getException());
				}
			}
		}
		
		if(foundRepeats.length > 0) {
			var repeatFile = foundRepeats[0];
			if(repeatFile.version == nextVersion) {
				foundRepeats.shift();
				if(!plugins.rawSQL.executeSQL(repeatFile.dbServer,repeatFile.getFileData())) {
					throw new Error('Failed to run migration SQL FILE: ' + versionFile.name + ' \n' + plugins.rawSQL.getException());
				}
			}
		}
		setServoyProperty('DB_VERSION',nextVersion.toString());
	}
	
	//Reload datamodel for all servers
	if(!application.isInDeveloper()) {
		var allServers = plugins.maintenance.getServerNames(true);
		for(var i in allServers) {
			plugins.maintenance.getServer(allServers[i]).reloadDataModel();
		}
	} else {
		application.output('Please Reload all tables/table structure from DB!!');
	}
}

/**
 * @protected 
 * @constructor  
 * @param {JSMedia} media
 * @properties={typeid:24,uuid:"DF868CC5-02DC-4969-9808-E8085043FD5A"}
 */
function parseMediaDBFile(media) {
	
	/**
	 * @type {JSMedia}
	 * @protected 
	 */
	this.mediaFile = media;
	
	/**
	 * @type {String}
	 * @public 
	 */
	this.name = this.mediaFile.getName();
	
	/**
	 * @type {Boolean}
	 * @public 
	 */
	this.isValidFile = function() {
		if(this.name.match(/^database-migration/)) {
			if(this.name.match(/database-migration\/(V|R)__/)) {
				if(this.name.match(/database-migration\/(V|R)__(\d*)__/)) {
					var dbName = this.name.replace(/database-migration\/(V|R)__(\d*)__/,'').split('__')[0];
					if(datasources.db[dbName]) {
						return true;
					} else {
						application.output('File contains an non existing Servoy DB Name V__xx__????: ' + this.name, LOGGINGLEVEL.ERROR);
					}
				} else {
					application.output('File is missing versionnumber V__??: ' + this.name, LOGGINGLEVEL.ERROR);
				}
			} else {
				application.output('File is missing type (V = Version | R = Repeat): ' + this.name, LOGGINGLEVEL.ERROR);
			}
		}
		
		return false;
	};
	
	/**
	 * @type {Number}
	 * @public 
	 */
	this.version = this.isValidFile() ? parseInt(this.name.match(/database-migration\/(V|R)__(\d*)__/)[0].replace(/\D/g,'')) : null;
	
	/**
	 * @type {String}
	 * @public 
	 */
	this.type = this.isValidFile() ? (this.name.match(/database-migration\/V__/) ? DB_IMPORT_TYPE.VERSION : DB_IMPORT_TYPE.REPEAT) : null;
	
	/**
	 * @type {String}
	 * @public 
	 */
	this.dbServer = this.isValidFile() ? this.name.replace(/database-migration\/(V|R)__(\d*)__/,'').split('__')[0] : null;;
	
	/**
	 * @return {String}
	 * @public 
	 */
	this.getFileData = function() {
		return this.mediaFile.getAsString();
	}
	
	Object.seal(this);
	return this;
}
/**
 * @private 
 * @param {JSMedia} a
 * @param {JSMedia} b 
 *
 * @properties={typeid:24,uuid:"9F07B7DD-D1BE-4FE3-9EBB-D4F9B489667C"}
 */
function sortVersion(a, b) {
	var correctA = parseMediaDBFile(a).version;
	var correctB = parseMediaDBFile(b).version;
	return correctA-correctB;
}

/**
 * @private 
 * @param {String} name
 * 
 * @return {String}
 *
 * @properties={typeid:24,uuid:"4972F6EF-56DA-4A3E-9279-2F02B26D671E"}
 */
function getServoyProperty(name) {
	var value = Packages.com.servoy.j2db.util.Settings.getInstance().get(name);
	if (!value) {
		return null;
	}
	
	return value.toString();
}

/**
 * @private 
 * @param {String} name
 * @param {String} value
 *
 * @properties={typeid:24,uuid:"574A1354-376C-4568-B39D-7B96093C450C"}
 */
function setServoyProperty(name, value) {
	var instance = Packages.com.servoy.j2db.util.Settings.getInstance();
	instance.put(name, value);
	instance.save();
}