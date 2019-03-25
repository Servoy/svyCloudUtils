/**
 * @private 
 * @properties={typeid:24,uuid:"760F74B0-BECC-413E-8BF7-CC17BF488AC4"}
 */
function test_getJenkinsBuildNr() {
	//when no number is set, it should return null
	jsunit.assertNull(scopes.svyQAPAAS.getJenkinsBuildNr());
	
	//when number is set, it should return value
	scopes.svyQAPAAS['JENKINS_BUILDNR'] = 10;
	jsunit.assertEquals(scopes.svyQAPAAS.getJenkinsBuildNr(), 10);
	jsunit.assertEquals(typeof scopes.svyQAPAAS.getJenkinsBuildNr(), 'number');
}

/**
 * @private 
 * @properties={typeid:24,uuid:"5C35266C-2FE9-4270-96C1-1CE83AF99819"}
 */
function test_getJenkinsBuildDate() {
	//when no number is set, it should return null
	jsunit.assertNull(scopes.svyQAPAAS.getJenkinsBuildDate());
	
	//when number is set, it should return value
	var date = new Date();
	//Remove milisecons, jenkins doesn't have it
	date.setMilliseconds(0);
	scopes.svyQAPAAS['JENKINS_BUILDDATE'] = utils.dateFormat(date,'dd-MM-yyyy HH:mm:ss');
	jsunit.assertEquals(scopes.svyQAPAAS.getJenkinsBuildDate().getTime(), date.getTime());
	
	//Why not date??
	jsunit.assertEquals(typeof scopes.svyQAPAAS.getJenkinsBuildDate(), 'object');
}

/**
 * @private 
 * @properties={typeid:24,uuid:"5FB32EFE-EF3A-4D8F-B703-83E609B79FBA"}
 */
function test_getSvnRevision() {
	//when no number is set, it should return null
	jsunit.assertNull(scopes.svyQAPAAS.getSvnRevision());
	
	//when number is set, it should return value
	scopes.svyQAPAAS['SVN_REVISION'] = '101';
	jsunit.assertEquals(scopes.svyQAPAAS.getSvnRevision(), '101');
	jsunit.assertEquals(typeof scopes.svyQAPAAS.getSvnRevision(), 'string');
}

/**
 * @private 
 * @properties={typeid:24,uuid:"91F513EA-B56E-43B5-B8F9-24F34EBEF3D8"}
 */
function test_getGitCommit() {
	//when no number is set, it should return null
	jsunit.assertNull(scopes.svyQAPAAS.getGitCommit());
	
	//when number is set, it should return value
	scopes.svyQAPAAS['GIT_COMMIT'] = 'dec8544c9f98dc02bfc873011f80e9722351bf1e';
	jsunit.assertEquals(scopes.svyQAPAAS.getGitCommit(), 'dec8544c9f98dc02bfc873011f80e9722351bf1e');
	jsunit.assertEquals(typeof scopes.svyQAPAAS.getGitCommit(), 'string');
}

/**
 * @private 
 * @properties={typeid:24,uuid:"CDAC47C4-A981-442E-BEF2-AD868BA4618B"}
 */
function test_getGitBranch() {
	//when no number is set, it should return null
	jsunit.assertNull(scopes.svyQAPAAS.getGitBranch());
	
	//when number is set, it should return value
	scopes.svyQAPAAS['GIT_BRANCH'] = 'origin/develop';
	jsunit.assertEquals(scopes.svyQAPAAS.getGitBranch(), 'origin/develop');
	jsunit.assertEquals(typeof scopes.svyQAPAAS.getGitBranch(), 'string');
}