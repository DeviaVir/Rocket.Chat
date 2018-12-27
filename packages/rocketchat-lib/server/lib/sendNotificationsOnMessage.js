import { Meteor } from 'meteor/meteor';
import moment from 'moment';

import { callJoinRoom, messageContainsHighlight, parseMessageTextPerUser, replaceMentionedUsernamesWithFullNames } from '../functions/notifications/';
import { sendEmail, shouldNotifyEmail } from '../functions/notifications/email';
import { sendSinglePush, shouldNotifyMobile } from '../functions/notifications/mobile';
import { notifyDesktopUser, shouldNotifyDesktop } from '../functions/notifications/desktop';
import { notifyAudioUser, shouldNotifyAudio } from '../functions/notifications/audio';

const sendNotification = ({
	subscription,
	sender,
	hasMentionToAll,
	hasMentionToHere,
	message,
	notificationMessage,
	room,
	mentionIds,
	disableAllMessageNotifications,
}) => {

	// don't notify the sender
	if (subscription.u._id === sender._id) {
		return;
	}

	// notifications disabled
	if (subscription.disableNotifications) {
		return;
	}

	// dont send notification to users who ignored the sender
	if (Array.isArray(subscription.ignored) && subscription.ignored.includes(sender._id)) {
		return;
	}

	const hasMentionToUser = mentionIds.includes(subscription.u._id);

	// mute group notifications (@here and @all) if not directly mentioned as well
	if (!hasMentionToUser && subscription.muteGroupMentions && (hasMentionToAll || hasMentionToHere)) {
		return;
	}

	const receiver = RocketChat.models.Users.findOneById(subscription.u._id);

	if (!receiver || !receiver.active) {
		return;
	}

	const roomType = room.t;
	// If the user doesn't have permission to view direct messages, don't send notification of direct messages.
	if (roomType === 'd' && !RocketChat.authz.hasPermission(subscription.u._id, 'view-d-room')) {
		return;
	}

	notificationMessage = parseMessageTextPerUser(notificationMessage, message, receiver);

	const isHighlighted = messageContainsHighlight(message, subscription.userHighlights);


	const {
		audioNotifications,
		desktopNotifications,
		mobilePushNotifications,
		emailNotifications,
	} = subscription;

	let notificationSent = false;

	// busy users don't receive audio notification
	if (shouldNotifyAudio({
		disableAllMessageNotifications,
		status: receiver.status,
		audioNotifications,
		hasMentionToAll,
		hasMentionToHere,
		isHighlighted,
		hasMentionToUser,
		roomType,
	})) {
		notifyAudioUser(subscription.u._id, message, room);
	}

	// busy users don't receive desktop notification
	if (shouldNotifyDesktop({
		disableAllMessageNotifications,
		status: receiver.status,
		desktopNotifications,
		hasMentionToAll,
		hasMentionToHere,
		isHighlighted,
		hasMentionToUser,
		roomType,
	})) {
		notificationSent = true;
		notifyDesktopUser({
			notificationMessage,
			userId: subscription.u._id,
			user: sender,
			message,
			room,
			duration: subscription.desktopNotificationDuration,
		});
	}

	if (shouldNotifyMobile({
		disableAllMessageNotifications,
		mobilePushNotifications,
		hasMentionToAll,
		isHighlighted,
		hasMentionToUser,
		statusConnection: receiver.statusConnection,
		roomType,
	})) {
		notificationSent = true;

		sendSinglePush({
			notificationMessage,
			room,
			message,
			userId: subscription.u._id,
			senderUsername: sender.username,
			senderName: sender.name,
			receiverUsername: receiver.username,
		});
	}

	if (receiver.emails && shouldNotifyEmail({
		disableAllMessageNotifications,
		statusConnection: receiver.statusConnection,
		emailNotifications,
		isHighlighted,
		hasMentionToUser,
		hasMentionToAll,
		roomType,
	})) {
		receiver.emails.some((email) => {
			if (email.verified) {
				sendEmail({ message, receiver, subscription, room, emailAddress: email.address, hasMentionToUser });

				return true;
			}
			return false;
		});
	}

	if (notificationSent) {
		RocketChat.Sandstorm.notify(message, [subscription.u._id], `@${ sender.username }: ${ message.msg }`, room.t === 'p' ? 'privateMessage' : 'message');
	}
};

function sendAllNotifications(message, room) {

	// skips this callback if the message was edited
	if (message.editedAt) {
		return message;
	}

	if (message.ts && Math.abs(moment(message.ts).diff()) > 60000) {
		return message;
	}

	if (!room || room.t == null) {
		return message;
	}

	const pushUsernames = {};

	const user = RocketChat.models.Users.findOneById(message.u._id);

	// might be a livechat visitor
	if (!user) {
		return message;
	}

	/*
	Increment unread couter if direct messages
	 */
	const settings = {
		alwaysNotifyDesktopUsers: [],
		dontNotifyDesktopUsers: [],
		alwaysNotifyMobileUsers: [],
		dontNotifyMobileUsers: [],
		desktopNotificationDurations: {},
		alwaysNotifyAudioUsers: [],
		dontNotifyAudioUsers: [],
		audioNotificationValues: {}
	};

	/**
	 * Checks if a given user can be notified
	 *
	 * @param {string} id
	 * @param {string} type - mobile|desktop
	 *
	 * @returns {boolean}
     */
	function canBeNotified(id, type) {
		const types = {
			desktop: [ 'dontNotifyDesktopUsers', 'alwaysNotifyDesktopUsers' ],
			mobile: [ 'dontNotifyMobileUsers', 'alwaysNotifyMobileUsers' ],
			audio: [ 'dontNotifyAudioUsers', 'alwaysNotifyAudioUsers' ]
		};

		return (settings[types[type][0]].indexOf(id) === -1 || settings[types[type][1]].indexOf(id) !== -1);
	}

	// Don't fetch all users if room exceeds max members
	const maxMembersForNotification = RocketChat.settings.get('Notifications_Max_Room_Members');
	const roomMembersCount = RocketChat.models.Subscriptions.findByRoomId(room._id).count();
	const disableAllMessageNotifications = roomMembersCount > maxMembersForNotification && maxMembersForNotification !== 0;
	const subscriptionsPush = RocketChat.models.Subscriptions.findNotificationPreferencesByRoom(room._id, disableAllMessageNotifications);
	const userIds = [];
	subscriptionsPush.forEach((s) => {
		userIds.push(s.u._id);
	});
	const users = {};
	RocketChat.models.Users.findUsersByIds(userIds, { fields: { 'settings.preferences': 1 } }).forEach((user) => {
		users[user._id] = user;
	});

	subscriptionsPush.forEach(subscription => {
		if (subscription.disableNotifications) {
			settings.dontNotifyDesktopUsers.push(subscription.u._id);
			settings.dontNotifyMobileUsers.push(subscription.u._id);
			settings.dontNotifyAudioUsers.push(subscription.u._id);
			return;
		}

		const {
			audioNotifications = RocketChat.getUserPreference(users[subscription.u._id], 'audioNotifications'),
			desktopNotifications = RocketChat.getUserPreference(users[subscription.u._id], 'desktopNotifications'),
			mobilePushNotifications = RocketChat.getUserPreference(users[subscription.u._id], 'mobileNotifications')
		} = subscription;

		if (audioNotifications === 'all' && !disableAllMessageNotifications) {
			settings.alwaysNotifyAudioUsers.push(subscription.u._id);
		}
		if (desktopNotifications === 'all' && !disableAllMessageNotifications) {
			settings.alwaysNotifyDesktopUsers.push(subscription.u._id);
		} else if (desktopNotifications === 'nothing') {
			settings.dontNotifyDesktopUsers.push(subscription.u._id);
		}
		if (mobilePushNotifications === 'all' && !disableAllMessageNotifications) {
			settings.alwaysNotifyMobileUsers.push(subscription.u._id);
		} else if (mobilePushNotifications === 'nothing') {
			settings.dontNotifyMobileUsers.push(subscription.u._id);
		}

		settings.audioNotificationValues[subscription.u._id] = subscription.audioNotificationValue;
		settings.desktopNotificationDurations[subscription.u._id] = subscription.desktopNotificationDuration;
	});
	let userIdsForAudio = [];
	let userIdsToNotify = [];
	let userIdsToPushNotify = [];
	const mentions = [];
	const alwaysNotifyMobileBoolean = RocketChat.settings.get('Notifications_Always_Notify_Mobile');

	const usersWithHighlights = RocketChat.models.Users.findUsersByUsernamesWithHighlights(room.usernames, { fields: { '_id': 1, 'settings.preferences.highlights': 1 }}).fetch()
		.filter(user => messageContainsHighlight(message, user.settings.preferences.highlights));

	let push_message = ' ';
	//Set variables depending on Push Notification settings
	if (RocketChat.settings.get('Push_show_message')) {
		push_message = parseMessageText(message, userId);
	}

	const sender = RocketChat.roomTypes.getConfig(room.t).getMsgSender(message.u._id);
	if (!sender) {
		return message;
	}

	const mentionIds = (message.mentions || []).map(({ _id }) => _id);
	const mentionIdsWithoutGroups = mentionIds.filter((_id) => _id !== 'all' && _id !== 'here');
	const hasMentionToAll = mentionIds.includes('all');
	const hasMentionToHere = mentionIds.includes('here');

	let notificationMessage = RocketChat.callbacks.run('beforeSendMessageNotifications', message.msg);
	if (mentionIds.length > 0 && RocketChat.settings.get('UI_Use_Real_Name')) {
		notificationMessage = replaceMentionedUsernamesWithFullNames(message.msg, message.mentions);
	}

	// console.log (room._id);
	// console.log (message);
	if (room.t == null || room.t === 'd') {
		const userOfMentionId = message.rid.replace(message.u._id, '');
		const userOfMention = RocketChat.models.Users.findOne({
			_id: userOfMentionId
		}, {
			fields: {
				username: 1,
				statusConnection: 1,
				curRoom: 1,
			}
		});

		// console.log (userOfMention);
		if (canBeNotified(userOfMentionId, 'mobile')) {
			// console.log ('sending mobile push 1');
			if (Push.enabled === true && (userOfMention.statusConnection !== 'online' || userOfMention.curRoom !== room._id || alwaysNotifyMobileBoolean === true)) {
				// console.log ('sending mobile push 2');
				RocketChat.PushNotification.send({
					roomId: message.rid,
					username: push_username,
					message: push_message,
					badge: getBadgeCount(userOfMention._id),
					payload: {
						host: Meteor.absoluteUrl(),
						rid: message.rid,
						sender: message.u,
						type: room.t,
						name: room.name
					},
					usersTo: {
						userId: userOfMention._id
					},
					category: canSendMessageToRoom(room, userOfMention.username) ? CATEGORY_MESSAGE : CATEGORY_MESSAGE_NOREPLY
				});
				return message;
			}
		}

		if (mentionIds.length + settings.alwaysNotifyMobileUsers.length > 0) {
			let mobileMentionIds = _.union(mentionIds, settings.alwaysNotifyMobileUsers);
			mobileMentionIds = _.difference(mobileMentionIds, settings.dontNotifyMobileUsers);

			const usersOfMobileMentionsQuery = {
				_id: {
					$in: mobileMentionIds
				}
			};

			if (alwaysNotifyMobileBoolean !== true) {
				//usersOfMobileMentionsQuery.statusConnection = { $ne: 'online' };
				usersOfMobileMentionsQuery['$or'] = [{statusConnection: { $ne: 'online' }}, {curRoom: {$ne: room._id}}];
			}

			let usersOfMobileMentions = RocketChat.models.Users.find(usersOfMobileMentionsQuery, {
				fields: {
					_id: 1,
					username: 1,
					statusConnection: 1,
					active: 1
				}
			}).fetch();

			mentions.push(...usersOfMobileMentions);
			if (room.t !== 'c') {
				usersOfMobileMentions = _.reject(usersOfMobileMentions, usersOfMentionItem => !room.usernames.includes(usersOfMentionItem.username));
			}

			userIdsToPushNotify = usersOfMobileMentions.map(userMobile => {
				pushUsernames[userMobile._id] = userMobile.username;
				return userMobile._id;
			})
		}
	}

	const query = {
		rid: room._id,
		$or: [{
			'userHighlights.0': { $exists: 1 },
		}],
	};

	['audio', 'desktop', 'mobile', 'email'].forEach((kind) => {
		const notificationField = `${ kind === 'mobile' ? 'mobilePush' : kind }Notifications`;

		const filter = { [notificationField]: 'all' };

		if (disableAllMessageNotifications) {
			filter[`${ kind }PrefOrigin`] = { $ne: 'user' };
		}

		query.$or.push(filter);

		if (mentionIdsWithoutGroups.length > 0) {
			query.$or.push({
				[notificationField]: 'mentions',
				'u._id': { $in: mentionIdsWithoutGroups },
			});
		} else if (!disableAllMessageNotifications && (hasMentionToAll || hasMentionToHere)) {
			query.$or.push({
				[notificationField]: 'mentions',
			});
		}

		const serverField = kind === 'email' ? 'emailNotificationMode' : `${ kind }Notifications`;
		const serverPreference = RocketChat.settings.get(`Accounts_Default_User_Preferences_${ serverField }`);
		if ((room.t === 'd' && serverPreference !== 'nothing') || (!disableAllMessageNotifications && (serverPreference === 'all' || hasMentionToAll || hasMentionToHere))) {
			query.$or.push({
				[notificationField]: { $exists: false },
			});
		} else if (serverPreference === 'mentions' && mentionIdsWithoutGroups.length) {
			query.$or.push({
				[notificationField]: { $exists: false },
				'u._id': { $in: mentionIdsWithoutGroups },
			});
		}
	});

	// the find bellow is crucial. all subscription records returned will receive at least one kind of notification.
	// the query is defined by the server's default values and Notifications_Max_Room_Members setting.
	const subscriptions = RocketChat.models.Subscriptions.findNotificationPreferencesByRoom(query);
	subscriptions.forEach((subscription) => sendNotification({
		subscription,
		sender,
		hasMentionToAll,
		hasMentionToHere,
		message,
		notificationMessage,
		room,
		mentionIds,
		disableAllMessageNotifications,
	}));

	// on public channels, if a mentioned user is not member of the channel yet, he will first join the channel and then be notified based on his preferences.
	if (room.t === 'c') {
		// get subscriptions from users already in room (to not send them a notification)
		const mentions = [...mentionIdsWithoutGroups];
		RocketChat.models.Subscriptions.findByRoomIdAndUserIds(room._id, mentionIdsWithoutGroups, { fields: { 'u._id': 1 } }).forEach((subscription) => {
			const index = mentions.indexOf(subscription.u._id);
			if (index !== -1) {
				mentions.splice(index, 1);
			}
		});

		Promise.all(mentions
			.map(async(userId) => {
				await callJoinRoom(userId, room._id);

				return userId;
			})
		).then((users) => {
			users.forEach((userId) => {
				const subscription = RocketChat.models.Subscriptions.findOneByRoomIdAndUserId(room._id, userId);

				sendNotification({
					subscription,
					sender,
					hasMentionToAll,
					hasMentionToHere,
					message,
					notificationMessage,
					room,
					mentionIds,
				});
			});
		}).catch((error) => {
			throw new Meteor.Error(error);
		});
	}

	return message;
}

RocketChat.callbacks.add('afterSaveMessage', sendAllNotifications, RocketChat.callbacks.priority.LOW, 'sendNotificationsOnMessage');

export { sendNotification };
