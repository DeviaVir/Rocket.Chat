/* globals Department, Livechat, LivechatVideoCall */

Template.livechatWindow.helpers({
	title() {
		return Livechat.title;
	},
	color() {
		return Livechat.color;
	},
	fontColor() {
		return Livechat.fontColor;
	},
	popoutActive() {
		return FlowRouter.getQueryParam('mode') === 'popout';
	},
	soundActive() {
		return Session.get('sound');
	},
	showRegisterForm() {
		if (Session.get('triggered') || Meteor.userId()) {
			return false;
		}
		return Livechat.registrationForm;
	},
	showSwitchDepartmentForm() {
		return Livechat.showSwitchDepartmentForm;
	},
	livechatStarted() {
		return Livechat.online !== null;
	},
	livechatOnline() {
		return Livechat.online;
	},
	offlineMessage() {
		return Livechat.offlineMessage;
	},
	offlineData() {
		return {
			offlineMessage: Livechat.offlineMessage.replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1<br>$2'),
			offlineSuccessMessage: Livechat.offlineSuccessMessage,
			offlineUnavailableMessage: Livechat.offlineUnavailableMessage.replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1<br>$2'),
			displayOfflineForm: Livechat.displayOfflineForm
		};
	},
	videoCalling() {
		return LivechatVideoCall.isActive();
	},
	isOpened() {
		return Livechat.isWidgetOpened();
	},
	showWidget() {
		return Livechat.online || Livechat.displayOfflineForm;
	},
  usersTyping() {
    room_typing = MsgTyping.get(visitor.getRoom());
    users = _.keys(room_typing.users);
    if (room_typing.input_text == "")
      return "";
    input_text = " is Typing";

    if (users.length ==  0)
      return "";
    if (users.length == 1)
      return users[0] + input_text;
  }
});

Template.livechatWindow.events({
	'click .title'() {
		parentCall('toggleWindow');
	},
	'click .popout'(event) {
		event.stopPropagation();
		parentCall('openPopout');
	},
	'click .sound'(event) {
		event.stopPropagation();
		Session.set({sound: !Session.get('sound')});
	}
});

Template.livechatWindow.onCreated(function() {
	Session.set({sound: true});

	const availableLanguages = TAPi18n.getLanguages();

	const defaultAppLanguage = () => {
		let lng = window.navigator.userLanguage || window.navigator.language || 'en';
		const regexp = /([a-z]{2}-)([a-z]{2})/;
		if (regexp.test(lng)) {
			lng = lng.replace(regexp, function(match, ...parts) {
				return parts[0] + parts[1].toUpperCase();
			});
		}
		return lng;
	};

	// get all needed live chat info for the user
	Meteor.call('livechat:getInitialData', visitor.getToken(), (err, result) => {
		if (err) {
			console.error(err);
		} else {
			if (!result.enabled) {
				Triggers.setDisabled();
				return parentCall('removeWidget');
			}

			if (!result.online) {
				Triggers.setDisabled();
				Livechat.title = result.offlineTitle;
				Livechat.offlineColor = result.offlineColor;
				Livechat.offlineMessage = result.offlineMessage;
				Livechat.displayOfflineForm = result.displayOfflineForm;
				Livechat.offlineUnavailableMessage = result.offlineUnavailableMessage;
				Livechat.offlineSuccessMessage = result.offlineSuccessMessage;
				Livechat.online = false;
			} else {
				Livechat.title = result.title;
				Livechat.onlineColor = result.color;
				Livechat.online = true;
				Livechat.transcript = result.transcript;
				Livechat.transcriptMessage = result.transcriptMessage;
			}
			Livechat.videoCall = result.videoCall;
			Livechat.registrationForm = result.registrationForm;

			if (result.room) {
				Livechat.room = result.room._id;
			}

			if (result.agentData) {
				Livechat.agent = result.agentData;
			}

			let language = result.language || defaultAppLanguage();

			if (!availableLanguages[language]) {
				language = language.split('-').shift();
			}

			TAPi18n.setLanguage(language);

			Triggers.setTriggers(result.triggers);
			Triggers.init();

			result.departments.forEach((department) => {
				Department.insert(department);
			});
			Livechat.allowSwitchingDepartments = result.allowSwitchingDepartments;
			Livechat.ready();
		}
	});

	$(window).on('focus', () => {
		if (Livechat.isWidgetOpened()) {
			$('textarea').focus();
		}
	});
});
