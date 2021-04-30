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
 * @param database
 *
 * @properties={typeid:24,uuid:"36E4C256-8D63-4A60-9C08-12902328516F"}
 */
function removeAllTablesFromDatabase(database) {
	var tables = databaseManager.createEmptyDataSet(0, ['tablename']);
	if (isPostgresDB(database)) {
		tables = databaseManager.getDataSetByQuery(database, "select tablename from pg_tables where schemaname = 'public'", [], -1);
	}

	for (var i = 0; i < tables.getMaxRowIndex(); i++) {
		plugins.rawSQL.executeSQL(database, 'drop table if exists ' + tables[i].tablename + ' cascade;');
	}

	if (!application.isInDeveloper()) {
		plugins.maintenance.getServer(database).reloadDataModel();
	}
}

/**
 * @private
 *
 * @param {String} dbName
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"6E4BCC0B-67F2-4156-96BC-D1B340CB0130"}
 */
function isPostgresDB(dbName) {
	return databaseManager.getDatabaseProductName(dbName).match('postgres') ? true : false;
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
 *
 * @param {String} [versionTableName] tableName to store the version data, when this is set it will not be stored in the servoy.properties file
 *
 * @properties={typeid:24,uuid:"0AAF4E9B-20E0-440E-ADB9-96CE939A5AE9"}
 */
function runDBVersionUpgrade(versionTableName) {
	var medias = solutionModel.getMediaList();
	/**@type {Array<parseMediaDBFile>} */
	var foundVersions = [];
	/**@type {Array<parseMediaDBFile>} */
	var foundRepeats = [];

	//Filter all the types and select matched on naming
	for each (var media in medias) {
		var parsedFile = new parseMediaDBFile(media);
		if (parsedFile.isValidFile()) {
			if (parsedFile.type == DB_IMPORT_TYPE.VERSION) {
				foundVersions.push(parsedFile);
			} else {
				foundRepeats.push(parsedFile);
			}
		}
	}

	//Sort everything on versionnumber
	foundVersions.sort(sortVersion);
	foundRepeats.sort(sortVersion);

	var nextVersion = 0;
	while (foundVersions.length > 0 || foundRepeats.length > 0) {
		nextVersion++;
		if (foundVersions.length > 0) {
			var versionFile = foundVersions[0];
			if (versionFile.version == nextVersion) {
				for each (var dbServerName in getAllDBs(versionFile.dbServer)) {
					createVersionTable(dbServerName, versionTableName);
					var currentVersion = getCurrentVersion(dbServerName, versionTableName);
					if (versionFile.version > currentVersion) {
						if (!plugins.rawSQL.executeSQL(dbServerName, versionFile.getFileData())) {
							throw new Error('Failed to run migration SQL FILE: ' + versionFile.name + ' \n' + plugins.rawSQL.getException());
						}
						setCurrentVersion(nextVersion, dbServerName, versionTableName);
					}
				}
				foundVersions.shift();
			}

			if (foundRepeats.length > 0) {
				var repeatFile = foundRepeats[0];
				if (repeatFile.version == nextVersion) {
					for each (dbServerName in getAllDBs(repeatFile.dbServer)) {
						if (!plugins.rawSQL.executeSQL(dbServerName, repeatFile.getFileData())) {
							throw new Error('Failed to run migration SQL FILE: ' + versionFile.name + ' \n' + plugins.rawSQL.getException());
						}
					}
					foundRepeats.shift();
				}
			}
		}
	}

	//Reload datamodel for all servers
	if (!application.isInDeveloper()) {
		var allServers = plugins.maintenance.getServerNames(true);
		for (var i in allServers) {
			plugins.maintenance.getServer(allServers[i]).reloadDataModel();
		}
	} else {
		application.output('Please Reload all tables/table structure from DB!!');
	}
}

/**
 * @private
 * @param {String} mainDB
 * @return {Array<String>}
 *
 * @properties={typeid:24,uuid:"B3FABE27-0A45-4FF0-8EB4-987CEE7D577D"}
 */
function getAllDBs(mainDB) {
	return [mainDB].concat(databaseManager.getDataModelClonesFrom(mainDB));
}

/**
 * @private
 * @param {String} serverName
 * @param {String} [tableName]
 *
 * @properties={typeid:24,uuid:"9AEC1FEC-4653-44CE-BE95-E63358B6C2BC"}
 */
function createVersionTable(serverName, tableName) {
	if (serverName && tableName) {
		if (!databaseManager.getTable(serverName, tableName)) {
			if (application.isInDeveloper()) {
				throw new Error("Creation of db_version table isn't supported from developer, please create table manual: " + tableName + " with columns: (`id`, type: text, length: 36, allowNull: false, PK, sequenceType: UUID Generator) && (`versionnumber`, type: int, allowNull: false)");
			}
			var versionTable = plugins.maintenance.getServer(serverName).createNewTable(tableName);
			var pkColumn = versionTable.createNewColumn('id', JSColumn.TEXT, 36, false, true);
			pkColumn.setFlag(JSColumn.UUID_COLUMN, true);
			pkColumn.sequenceType = JSColumn.UUID_GENERATOR;
			versionTable.createNewColumn('versionnumber', JSColumn.INTEGER, 0, false);

			plugins.maintenance.getServer(serverName).synchronizeWithDB(versionTable);
		}
	}
}

/**
 * @private
 * @param {String} [serverName]
 * @param {String} [tableName]
 *
 * @return {Number}
 * @properties={typeid:24,uuid:"DE8A7943-F805-48B4-97C8-A593AD27F7F9"}
 */
function getCurrentVersion(serverName, tableName) {
	var currentVersion = 0;
	if (serverName && tableName) {
		/**@type {QBSelect} */
		var sql = datasources.db[serverName][tableName].createSelect();
		sql.result.add(sql.columns['versionnumber']);

		//Get all data, sorting on int can be different based on DB settings
		var ds = databaseManager.getDataSetByQuery(sql, -1);
		for (var i = 1; i <= ds.getMaxRowIndex(); i++) {
			if (currentVersion <= parseInt(ds.getValue(i, 1))) {
				currentVersion = ds.getValue(i, 1);
			}
		}
	} else {
		currentVersion = parseInt(getServoyProperty(serverName.toUpperCase() + '.DB_VERSION') || getServoyProperty('DB_VERSION') || '0');
	}
	return currentVersion
}

/**
 * @private
 * @param {Number} versionNumber
 * @param {String} [serverName]
 * @param {String} [tableName]
 *
 * @properties={typeid:24,uuid:"AD19F72E-FB45-47AE-8986-2C80B0AE951D"}
 */
function setCurrentVersion(versionNumber, serverName, tableName) {
	if (serverName && tableName) {
		/**@type {JSFoundSet} */
		var fs = datasources.db[serverName][tableName].getFoundSet();
		if (fs) {
			var rec = fs.getRecord(fs.newRecord());
			rec['versionnumber'] = versionNumber;
			databaseManager.saveData(rec);
		}
	} else {
		setServoyProperty(serverName.toUpperCase() + '.DB_VERSION', versionNumber.toString());
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
		if (this.name.match(/^database-migration/)) {
			if (this.name.match(/database-migration\/(V|R)__/)) {
				if (this.name.match(/database-migration\/(V|R)__(\d*)__/)) {
					var dbName = this.name.replace(/database-migration\/(V|R)__(\d*)__/, '').split('__')[0];
					if (datasources.db[dbName]) {
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
	this.version = this.isValidFile() ? parseInt(this.name.match(/database-migration\/(V|R)__(\d*)__/)[0].replace(/\D/g, '')) : null;

	/**
	 * @type {String}
	 * @public
	 */
	this.type = this.isValidFile() ? (this.name.match(/database-migration\/V__/) ? DB_IMPORT_TYPE.VERSION : DB_IMPORT_TYPE.REPEAT) : null;

	/**
	 * @type {String}
	 * @public
	 */
	this.dbServer = this.isValidFile() ? this.name.replace(/database-migration\/(V|R)__(\d*)__/, '').split('__')[0] : null;
	;

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
 * @param {parseMediaDBFile} a
 * @param {parseMediaDBFile} b
 *
 * @return {Number}
 *
 * @properties={typeid:24,uuid:"9F07B7DD-D1BE-4FE3-9EBB-D4F9B489667C"}
 */
function sortVersion(a, b) {
	var correctA = a.version;
	var correctB = b.version;
	return correctA - correctB;
}

/**
 * @public
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
 * @public
 * @param {String} name
 *
 * @return {String}
 *
 * @properties={typeid:24,uuid:"A272EF15-EF8E-486C-9CF6-6C118EC5BD9D"}
 */
function getSystemProperty(name) {
	var value = Packages.java.lang.System.getProperty(name);
	if (!value) {
		return null;
	}
	return value.toString();
}

/**
 * @public
 * @param {String} name
 *
 * @return {String}
 *
 * @properties={typeid:24,uuid:"608BEC9A-238A-4427-ACBD-14374AA11FAE"}
 */
function getEnvironmentProperty(name) {
	var value = Packages.java.lang.System.getenv(name);
	if (!value) {
		return null;
	}
	return value.toString();
}

/**
 * @public
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
