Meteor.methods({
	openRoom(rid) {
		check(rid, String);

		if (!Meteor.userId()) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', {
				method: 'openRoom'
			});
		}
		// console.log (rid);

		return RocketChat.models.Subscriptions.openByRoomIdAndUserId(rid, Meteor.userId());
	}
});
