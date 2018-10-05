const schedule = require( "node-schedule" );
var latestColumnsUpdate = null;

const REDIS = require( "redis" );
var redis = null;

const cheerio = require( "cheerio" );
const request = require( "request" );

const Eris = require( "eris" );
var discordBot = null;
var discordCreds = null;

const Base64 = require( "js-base64" ).Base64;

function W_SLEEP( ms ) { return new Promise( resolve => setTimeout( resolve , ms ) ); }


// DISCORD-BOT
// ==========================================================================================
function POST_ID( wMessage , wChannelID ) {
	return new Promise( async function( resolve , reject ) {
		try {
			if ( !discordBot ) { resolve(); return; }
			await discordBot.createMessage( wChannelID , wMessage );
			resolve();
		}
		catch( error ) { console.log( error ); reject( error ); }
	});
}

function POST_ERROR( wStatus ) {
	return new Promise( async function( resolve , reject ) {
		try {
			if ( !discordBot ) { resolve(); return; }
			if ( !wStatus ) { resolve(); return; }
			if ( typeof wStatus !== "string" ) {
				try { wStatus = wStatus.toString(); }
				catch( e ) { wStatus = e; }
			}
			await discordBot.createMessage( discordCreds.channels.error , wStatus );
			resolve();
		}
		catch( error ) { console.log( error ); reject( error ); }
	});
}

function SHUTDOWN_DISCORD() {
	return new Promise( async function( resolve , reject ) {
		try {
			await discordBot.disconnect();			
			resolve();
		}
		catch( error ) { console.log( error ); reject( error ); }
	});
}

function INITIALIZE_DISCORD() {
	return new Promise( async function( resolve , reject ) {
		try {
			
			console.log( "Discord Init" );
			discordCreds = require( "./personal.js" ).discord;
			discordBot = new Eris.CommandClient( discordCreds.token , {} , {
				description: "The Cipher Brief Discord Sync",
				owner: discordCreds.bot_id ,
				prefix: "!"
			});

			// var twitchCommand = discordBot.registerCommand( "twitch" , ( msg , args ) => {
			// 	if( args.length === 0 ) {
			// 		require( "./clientManager.js" ).pressButtonMaster( "3" );
			// 	}
			// 	return;
			// }, {
			// 	description: "Start Twitch State",
			// 	fullDescription: "Start Twitch State",
			// 	usage: "<text>" ,
			// 	reactionButtonTimeout: 0
			// });

			// twitchCommand.registerSubcommand( "follow" , async ( msg , args ) => {
			// 	if( args.length === 0 ) {
			// 		return "Invalid input";
			// 	}
			// 	await require( "./utils/twitchAPI_Utils.js" ).followUserName( args[ 0 ] );
			// 	const followers = await require( "./utils/twitchAPI_Utils.js" ).getFollowers();
			// 	if ( followers ) { if ( followers.length > 0 ) { return followers.join( " , " ); } }
			// 	return;
			// }, {
			// 	description: "Follow Twitch User",
			// 	fullDescription: "Follow Twitch User",
			// 	usage: "<text>" ,
			// 	reactionButtonTimeout: 0
			// });

			await discordBot.connect();
			resolve();

		}
		catch( error ) { console.log( error ); reject( error ); }
	});
}
// DISCORD-BOT
// ==========================================================================================


// REDIS
// ==========================================================================================
function INITIALIZE_REDIS() {
	return new Promise( async function( resolve , reject ) {
		try {
			redis = await REDIS.createClient({ 
				host: "localhost" ,
				
				// Production //
				port: "6379" ,
				db: "9" ,

				retry_strategy: function ( options ) {
			        if (options.error && options.error.code === 'ECONNREFUSED') {
			            // End reconnecting on a specific error and flush all commands with
			            // a individual error
			            return new Error('The server refused the connection');
			        }
			        if ( options.total_retry_time > 1000 * 60 * 60 ) {
			            // End reconnecting after a specific timeout and flush all commands
			            // with a individual error
			            return new Error('Retry time exhausted');
			        }
			        if ( options.attempt > 20 ) {
			            // End reconnecting with built in error
			            return undefined;
			        }
			        // reconnect after
			        return Math.min( options.attempt * 100 , 3000 );
			    }
			});
			console.log( "REDIS SUCCESS" );
			module.exports.redisClient = redis;
			resolve();
		}
		catch( error ) { console.log( error ); reject( error ); }
	});
}

function DELETE_KEY( wKey ) {
	return new Promise( function( resolve , reject ) {
		try { redis.del( wKey , function( err , keys ) { resolve( keys ); }); }
		catch( error ) { console.log( error ); reject( error ); }
	});
}

function SET_SET_FROM_ARRAY( wKey , wArray ) {
	return new Promise( function( resolve , reject ) {
		try { redis.sadd.apply( redis , [ wKey ].concat( wArray ).concat( function( err , keys ){ resolve( keys ); })); }
		catch( error ) { console.log( error ); reject( error ); }
	});
}

function SET_DIFFERENCE_STORE( wStoreKey , wSetKey , wCompareSetKey  ) {
	return new Promise( function( resolve , reject ) {
		try { redis.sdiffstore( wStoreKey , wSetKey , wCompareSetKey , function( err , values ) { resolve( values ); }); }
		catch( error ) { console.log( error ); reject( error ); }
	});
}

function GET_FULL_SET( wKey ) {
	return new Promise( function( resolve , reject ) {
		try { redis.smembers( wKey , function( err , values ) { resolve( values ); }); }
		catch( error ) { console.log( error ); reject( error ); }
	});
}

const ALREADY_TRACKED_LATEST_COLUMNS = "TCB.LATEST_COLUMNS";
function RETURN_UNEQ_RESULTS_AND_SAVE_INTO_REDIS( wCommonResults , wKey ) {
	return new Promise( async function( resolve , reject ) {
		try {
			// Sanitize
			if ( !wCommonResults ) { resolve( [] ); return; }
			if ( wCommonResults.length < 1 ) { resolve( [] ); return; }
			for ( var i = 0; i < wCommonResults.length; ++i ) {
				if ( !wCommonResults[ i ][ "urlBase64" ] ) { wCommonResults.slice( i , 1 ); continue; }
				if ( wCommonResults[ i ][ "urlBase64" ].length < 7 ) { wCommonResults.slice( i , 1 ); continue; }
			}
			console.log( wCommonResults );

			// 1.) Generate Random-Temp Key
			var wTempKey = Math.random().toString(36).substring(7);
			var R_PLACEHOLDER = "SCANNERS." + wTempKey + ".PLACEHOLDER";
			var R_NEW_TRACKING = "SCANNERS." + wTempKey + ".NEW_TRACKING";
			console.log( R_PLACEHOLDER );
			console.log( R_NEW_TRACKING );

			// 2.) Compare to Already 'Tracked' DOIs and Store Uneq
			var b64_DOIS = wCommonResults.map( x => x[ "urlBase64" ] );
			//console.log( b64_DOIS );
			await SET_SET_FROM_ARRAY( R_PLACEHOLDER , b64_DOIS );
			await SET_DIFFERENCE_STORE( R_NEW_TRACKING , R_PLACEHOLDER , ALREADY_TRACKED_LATEST_COLUMNS );
			await DELETE_KEY( R_PLACEHOLDER );
			await SET_SET_FROM_ARRAY( ALREADY_TRACKED_LATEST_COLUMNS , b64_DOIS );

			// 3.) Retrieve The 'Difference' Set
			const wNewTracking = await GET_FULL_SET( R_NEW_TRACKING );
			if ( !wNewTracking ) { 
				await DELETE_KEY( R_NEW_TRACKING ); 
				console.log( "nothing new found" ); 
				resolve( [] );
				return;
			}
			if ( wNewTracking.length < 1 ) {
				await DELETE_KEY( R_NEW_TRACKING );
				console.log( "nothing new found" ); 
				resolve( [] );
				return;
			}
			//console.log( "are we here ??" );
			// 4.) Filter Out Results to Return 'New-Valid' Tweets
			wCommonResults = wCommonResults.filter( x => wNewTracking.indexOf( x[ "urlBase64" ] ) !== -1 );
			await DELETE_KEY( R_NEW_TRACKING );
			resolve( wCommonResults );

		}
		catch( error ) { console.log( error ); reject( error ); }
	});
}
// REDIS
// ==========================================================================================

// PARSING LATEST COLUMNS PAGE
// ==========================================================================================
const ColumnBaseURL = "https://www.thecipherbrief.com";
function CUSTOM_CHERRIO_PARSER( wBody ) {
	//console.log( wBody );
	try { var $ = cheerio.load( wBody ); }
	catch(err) { reject( "cheerio load failed" ); return; }

	var final_articles = [];

	var articles = $( ".site-main" );
	if ( articles ) {
		articles = $( articles ).children();
		if ( articles ) {
			if ( articles.length < 1 )  { return "error"; }
			for ( var i = 0; i < articles.length; ++i ) {
				var wArticle = { published_time: null , updated_time: null , urlBase64: null , url: null , title: null , author: null , description: null };
				//console.log( articles[ i ].html() );
				var url = $( articles[ i ] ).children( "a" )[ 0 ];
				if ( url ) {
					url = $(  url ).attr( "href" );
					if ( url ) {
						
						wArticle.urlBase64 = Base64.encode( url );
						wArticle.url = ColumnBaseURL + url;
						console.log( url );
						var time_stamp = $( articles[ i ] ).find( "div.timestamp-mobile" )[ 0 ];
						time_stamp = $( time_stamp ).children();
						var published_time = $( time_stamp[ 0 ] ).text();
						if ( published_time ) {
							published_time = published_time.trim();
							wArticle.published_time = published_time;
						}
						var updated_time = $( time_stamp[ 1 ] ).text();
						if ( updated_time ) {
							updated_time = updated_time.trim();
							wArticle.updated_time = updated_time;
						}

						var title = $( articles[ i ] ).find( "h2" )[ 0 ];
						if ( title ) {
							title = $( title ).text();
							title = title.trim();
							if ( title ) {
								if ( title.length > 0 ) {
									wArticle.title = title;
								}
								
							}
						}

						var author = $( articles[ i ] ).find( "h3" )[ 0 ];
						if ( author ) {
							author = $( author ).text();
							author = author.trim();
							if ( author ) {
								if ( author.length > 0 ) {
									wArticle.author = author;
								}
								
							}
						}

						var description = $( articles[ i ] ).find( "p" )[ 0 ];
						if ( description ) {
							description = $( description ).text();
							description = description.trim();
							if ( description ) {
								if ( description.length > 0 ) {
									wArticle.description = description;
								}
								
							}
						}

					}
				}
				if ( wArticle.title !== null ) {
					var formated_post = "**" + wArticle.title + "**";
					if ( wArticle.updated_time !== null ) {
						if ( wArticle.published_time !== null ) {
							formated_post = "Published @@ " + wArticle.published_time + " --- Updated @@ " + wArticle.updated_time  + " --- " + formated_post;
						}
						else { formated_post = "Updated @@ " + wArticle.updated_time + " --- " + formated_post; }
					}
					else if ( wArticle.published_time ) { formated_post = "Published @@ " + wArticle.published_time + " --- " + formated_post; }
					if ( wArticle.description !== null ) { formated_post = formated_post + " --- " + wArticle.description; }
					if ( wArticle.url ) { formated_post = formated_post + " <" + wArticle.url + ">"; }
					wArticle.formated_post = formated_post;
					final_articles.unshift( wArticle );
				}
			}
		}
	}

	return final_articles;

}

const LatestColumnsURL = "https://www.thecipherbrief.com/column";
function GET_LATEST_COLUMNS_PAGE() {
	return new Promise( function( resolve , reject ) {
		try {
			request( LatestColumnsURL , async function ( err , response , body ) {
				if ( err ) { resolve( "error" ); return; }
				console.log( LatestColumnsURL + "\n\t--> RESPONSE_CODE = " + response.statusCode.toString() );
				if ( response.statusCode !== 200 ) {;
					resolve( "error" );
					return;
				}
				else {
					resolve( body );
					return;
				}
			});	
		}
		catch( error ) { console.log( error ); reject( error ); }
	});
}
// PARSING LATEST COLUMNS PAGE
// ==========================================================================================

( async ()=> {

	await INITIALIZE_REDIS();
	await INITIALIZE_DISCORD();

	// Testing
	// var latestColumnsPage = await GET_LATEST_COLUMNS_PAGE();
	// var latestResults = CUSTOM_CHERRIO_PARSER( latestColumnsPage );
	// console.log( latestResults );
	// if ( latestResults ) {
	// 	var unseen_results = await RETURN_UNEQ_RESULTS_AND_SAVE_INTO_REDIS( latestResults , ALREADY_TRACKED_LATEST_COLUMNS );
	// 	if ( unseen_results ) {
	// 		if ( unseen_results.length > 0 ) {
	// 			for ( var i = 0; i < unseen_results.length; ++i ) {
	// 				await POST_ID( unseen_results[ i ].formated_post , discordCreds.channels.general );
	// 				await W_SLEEP( 1000 );
	// 			}
	// 		}
	// 	}
	// }
	// Testing

	// Every 15 Minutes
	latestColumnsUpdate = schedule.scheduleJob( "*/15 * * * *" , async function() {
		var latestColumnsPage = await GET_LATEST_COLUMNS_PAGE();
		if ( latestColumnsPage ) {
			if ( latestColumnsPage !== "error" ) {
				var latestResults = CUSTOM_CHERRIO_PARSER( latestColumnsPage );
				if ( latestResults ) {
					var unseen_results = await RETURN_UNEQ_RESULTS_AND_SAVE_INTO_REDIS( latestResults , ALREADY_TRACKED_LATEST_COLUMNS );
					if ( unseen_results ) {
						if ( unseen_results.length > 0 ) {
							for ( var i = 0; i < unseen_results.length; ++i ) {
								await W_SLEEP( 1000 );
								await POST_ID( unseen_results[ i ].formated_post , discordCreds.channels.general );
							}
						}
					}
				}
			}
		}
	});

	await W_SLEEP( 3000 );
	await POST_ID( "Bot Restarted" , discordCreds.channels.general );

})();