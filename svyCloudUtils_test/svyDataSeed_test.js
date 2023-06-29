/**
 * @properties={typeid:24,uuid:"A9E10557-3A91-4832-91F4-A7054A0C5790"}
 */
function test_getWorkspacePath() {
	var workspacePath =  scopes.svyDataSeed.getWorkspacePath();
	jsunit.assertNotNull(workspacePath);
	jsunit.assertNotNull(plugins.file.convertToJSFile(workspacePath));
}

/**
 * @properties={typeid:24,uuid:"42B41D57-4928-40C8-8BE1-45FC36BD68C5"}
 */
function test_createDataSeedFile() {
	
	var workspacePath = scopes.svyDataSeed.getWorkspacePath();
	var dbFolderPathNonExists = [workspacePath, 'svyQAPAAS', 'medias', 'dataseeds','non_existing_db'].join(scopes.svyIO.getFileSeperator());
	var dbFolderPath = [workspacePath, 'svyQAPAAS', 'medias', 'dataseeds','example_data'].join(scopes.svyIO.getFileSeperator());
	var tempFolder = [workspacePath, 'svyQAPAAS','temp_export'].join(scopes.svyIO.getFileSeperator());
	//Test if dataseed creation will stop when no dbName
	jsunit.assertFalse(scopes.svyDataSeed.createDataSeedFile(null));
	
	//Test if db doens't exist
	jsunit.assertTrue(scopes.svyDataSeed.createDataSeedFile('non_existing_db'));
	jsunit.assertFalse(plugins.file.convertToJSFile(dbFolderPathNonExists).exists());
	jsunit.assertFalse(plugins.file.convertToJSFile(tempFolder).exists());
	
	//Test dataseeds
	jsunit.assertTrue(scopes.svyDataSeed.createDataSeedFile('example_data'));
	jsunit.assertFalse(plugins.file.convertToJSFile(dbFolderPath).exists());
	jsunit.assertTrue(plugins.file.convertToJSFile(dbFolderPath + '.zip').exists());
	jsunit.assertFalse(plugins.file.convertToJSFile(tempFolder).exists());
}

/**
 * @properties={typeid:24,uuid:"77CBA22F-B3F2-453A-9E2A-0A080AFACA36"}
 */
function test_importDataSeeds() {
	scopes.svyDataSeed.runDataseedFromMedia();
	
	var fs = datasources.db.example_data.employees.getFoundSet();
	fs.loadAllRecords();
	jsunit.assertEquals(10,databaseManager.getFoundSetCount(fs));
}

/**
 * @properties={typeid:24,uuid:"9BB30BF3-F1AF-4CAE-B91B-30526084C143"}
 */
function setUp() {
	//SETUP the example data to match all needed things to validate the export & import
	var allTables = databaseManager.getTableNames('example_data');
	for(var i in allTables) {
		var fs = databaseManager.getFoundSet('example_data', allTables[i]);
		fs.loadAllRecords();
		fs.deleteAllRecords();
		databaseManager.saveData(fs);
		fs.clear();
	}
	
	var fsEmployee = datasources.db.example_data.employees.getFoundSet();
	for(i = 1; i <= 10; i++) {
		var rec = fsEmployee.getRecord(fsEmployee.newRecord());
		rec.lastname = "Dodsworth";
		rec.firstname = 'Anne';
		rec.title = 'Sales Representative';
		rec.titleofcourtesy = 'Ms.'
		rec.birthdate = new Date().setMonth(i);
		rec.hiredate = null
		rec.address = "Houndstoo'th Rd."
		rec.city = 'London'
		rec.region = null
		rec.postalcode = "WG2,,, 7LT"
		rec.notes = 'Anne\nhas\na\nBA\ndegree\ni\nEnglish\nfrom'
		rec.photopath = "http://accweb/emmployees/davolio.bmp"
	}
	databaseManager.saveData();
}