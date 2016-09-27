'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const db = global.db = new sqlite3.Database('./soon.db');

const bodyParser = require('body-parser');
const compression = require('compression');
const exphbs	= require('express-handlebars');
const moment = require('moment');
const countdown = require('countdown');
require('moment-countdown');
const SQL_STATEMENTS = require('./sqlStatements');
const createHelpers = require('./createHelpers');
const twitterHelpers = require('./twitterHelpers');

db.serialize(() => {
	SQL_STATEMENTS.init.forEach(statement => {
		db.run(statement);
	});
});

var app = express();

app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');

app.use(compression());
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get(['/', 'index'], function (req, res) {
		res.render('index', {
			title: "Soon"
		});
});

app.get('/create', function (req, res) {
		res.render('create', {
			title: "Create Countdown - Soon"
		});
});

app.post('/create', function(req, res) {
	createHelpers.validateInput(req, res, function(isValid, errors) {
		if (isValid) {
			let values = createHelpers.generateValues(req, res);
			let hashtagsArray = createHelpers.generateHashtagArray(req.body.twitterHashtags);

			createHelpers.createCountdown(values, hashtagsArray).then(countdownId => {
				console.log('countdown created');

				//TODO: restructure create process
				let selectCountdownStatement = SQL_STATEMENTS.select.countdown;
				db.get(selectCountdownStatement, [countdownId], (error, row) => {
					//TODO: error handling
					res.redirect(`/c/${row.uuid}`);
				});

			}).catch(error => {
				console.error('error in createCountdown chain: ', error);
			});
		} else {
			let cdIsRel = (req.body.cdType == 'rel') ? true : false;
			res.render('create', {'body': req.body, 'cdIsRel': cdIsRel, 'errors': errors}); // render create page with current values and errors
		}
	});
});

app.get('/c/:uuid', function (req, res) {
	let uuid = req.params.uuid;

	console.log(`detail view for uuid ${uuid} requested...`);
	let selectCountdownStatement = SQL_STATEMENTS.select.countdownByUUID;
	let selectHashtagsStatement = SQL_STATEMENTS.select.hashtagsForCountdown;

	db.all(selectCountdownStatement, [uuid], (error, infos) => {
		if (error || infos.length !== 1) {
			console.log(`could not fetch uuid ${uuid}`);
			res.status(404);
			// TODO: Implement 404 page
			res.end('Countdown not found');
			return;
		}

		let now = new Date().getTime();
		let info = infos[0];
		let end = info.endTimestamp;
		let isRelativeCountdown = info.startTimestamp != null;
		let hashtagsArray = [];
		let percentage = null;

		let remainingSeconds = (info.endTimestamp - now) / 1000;
		remainingSeconds = Math.ceil(remainingSeconds);
		remainingSeconds = remainingSeconds < 0 ? 0 : remainingSeconds;

		// calculate current downlaod progress percentage
		if (isRelativeCountdown) {
			let start = info.startTimestamp;

			let totalDiff = end - start;
			let currentDiff = end - now;
			if (totalDiff > 0 && currentDiff < totalDiff) {
				percentage = 100 - (100*(currentDiff/totalDiff));
				percentage = Math.round(percentage);
				percentage = percentage > 100 ? 100 : percentage;
			}
		}

		let countdown = moment().countdown(end).toString();
		let endDate = moment(end).format('dddd, MMMM Do YYYY, h:mm:ss a') + ' (UTC)';

		// Fetch associated hashtags
		let id = info.id;
		db.each(selectHashtagsStatement, [id], (error, hashtag) => {
			if (error) {
				throw error;
			}

			hashtagsArray.push(`#${hashtag.name}`);
			}, () => {
				let render = (tweets) => {
					console.log('rendering details view');
					debugger;
					let hashtagsString = hashtagsArray.join(' ');
					let tweetsVisible = tweets && tweets.length > 0;

					res.render('detail', {
						title: `${info.title} - Soon`,
						cTitle: info.title,
						cDescription: info.description,
						cEndDate: endDate,
						cHashtags: hashtagsString,
						cPercentage: percentage,
						cPercentageBarValue: percentage/2,
						cCountdown: countdown,
						percentageVisible: percentage != null,
						remainingSeconds: remainingSeconds,
						tweetsVisible: tweetsVisible,
						tweets: tweets,
						isRelativeCountdown: isRelativeCountdown
					});
				}

				if (hashtagsArray.length > 0) {
					twitterHelpers.getTweetsForHashtags(hashtagsArray)
						.catch((error) => {
							console.error(error);
						}).then((tweets) => {
							let statuses = tweets.statuses;
							twitterHelpers.patchStatuses(statuses);
							debugger;
							return render(tweets.statuses);
						});
				} else {
					render();
				}
		});
	});
});

app.listen(3000, function () {
	console.log('Soon is available on port 3000!');
});
//
// function cleanup() {
// 	console.log('Shutting down...');
// 	db.close();
// }
//
// process.on('exit', (code) => {
// 	cleanup();
// 	process.exit(code);
// });
//
// process.on('SIGINT', (code) => {
// 	cleanup();
// 	process.exit(code);
// });
