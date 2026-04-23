# GymLog

Progressive overload tracker. Quick-log weight + reps per exercise, visualize your progress over time.

## Setup

### 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it → create

### 2. Enable Firestore

1. In your project → **Build → Firestore Database**
2. Click **Create database** → choose **Production mode** → pick a region

### 3. Set Firestore security rules

In **Firestore → Rules**, replace the default with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Publish the rules.

### 4. Enable Google Sign-in

1. **Build → Authentication → Get started**
2. **Sign-in method** tab → enable **Google**
3. Add your authorized domain (e.g. `yourname.github.io`) under **Authorized domains**

### 5. Add your Firebase config

1. In Firebase → **Project Settings** (gear icon) → **Your apps** → click the `</>` web icon to register an app
2. Copy the `firebaseConfig` object values into `firebase-config.js`:

```js
const firebaseConfig = {
  apiKey:            "...",
  authDomain:        "...",
  projectId:         "...",
  storageBucket:     "...",
  messagingSenderId: "...",
  appId:             "..."
};
```

### 6. Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to **Deploy from branch → main → / (root)**
4. Your app will be live at `https://yourusername.github.io/FitnessTracker`

## Usage

- **Home**: list of all your exercises
- **+** button on a card: fastest path — opens the log modal immediately
- **Tap a card**: opens the exercise detail with a progression chart + history
- **Chart**: Y-axis = weight, each point labeled with rep count — you can see exactly when you increased weight after hitting your rep target

## PWA (Add to Home Screen)

On iPhone: open the app in Safari → Share → **Add to Home Screen**  
On Android: Chrome will prompt you to install automatically
